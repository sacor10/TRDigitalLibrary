import serverless from 'serverless-http';

import { createApp } from '../../server/src/app.js';
import { openLibraryDb } from '../../server/src/db.js';

type ServerlessHandler = ReturnType<typeof serverless>;

let handlerPromise: Promise<ServerlessHandler> | undefined;

async function createHandler(): Promise<ServerlessHandler> {
  // The library DB lives on Turso and is shared across every environment.
  // The Netlify build (see netlify.toml) keeps it populated via
  // scripts/run-build-ingest.mjs, so the function only ever opens a remote
  // libSQL connection here — no /tmp copy, no bundled .db file.
  const tursoLibraryUrl = process.env.TURSO_LIBRARY_DATABASE_URL;
  const tursoLibraryAuthToken = process.env.TURSO_LIBRARY_AUTH_TOKEN;

  if (!tursoLibraryUrl) {
    throw new Error(
      'TURSO_LIBRARY_DATABASE_URL is not set. Configure it (and TURSO_LIBRARY_AUTH_TOKEN) ' +
        'in the Netlify site environment so the API can reach the hosted library DB.',
    );
  }

  const sessionSecret = process.env.SESSION_SECRET;
  const tursoDatabaseUrl = process.env.TURSO_DATABASE_URL;
  const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const annotationsEnabled = Boolean(sessionSecret && tursoDatabaseUrl);

  // Open the library DB and (when configured) the annotations DB in parallel.
  // Each open does a round-trip to Turso to verify migrations; doing them
  // sequentially doubled cold-start latency.
  const annotationsModulesPromise = annotationsEnabled
    ? Promise.all([
        import('../../server/src/annotations-db.js'),
        import('../../server/src/auth/google.js'),
      ])
    : null;

  const [db, annotationsBundle] = await Promise.all([
    openLibraryDb({
      url: tursoLibraryUrl,
      ...(tursoLibraryAuthToken ? { authToken: tursoLibraryAuthToken } : {}),
    }),
    annotationsModulesPromise
      ? annotationsModulesPromise.then(async ([{ openAnnotationsDb }, { createGoogleVerifier }]) => {
          const annotationsDb = await openAnnotationsDb({
            url: tursoDatabaseUrl as string,
            ...(tursoAuthToken ? { authToken: tursoAuthToken } : {}),
          });
          return { annotationsDb, createGoogleVerifier };
        })
      : Promise.resolve(null),
  ]);

  // Auth and annotations need a writable production store. If either required
  // piece is missing, keep the read-only document API online and leave auth off.
  const annotationsOptions: Record<string, unknown> = annotationsBundle
    ? {
        annotationsDb: annotationsBundle.annotationsDb,
        sessionSecret,
        ...(googleClientId
          ? { verifyGoogleIdToken: annotationsBundle.createGoogleVerifier(googleClientId) }
          : {}),
      }
    : {};

  const app = createApp(db, {
    readonly: true,
    corsOrigins: [],
    ...annotationsOptions,
  });

  return serverless(app);
}

async function getHandler(): Promise<ServerlessHandler> {
  handlerPromise ??= createHandler();
  return handlerPromise;
}

export const handler = async (event: object, context: object) => {
  const currentHandler = await getHandler();
  return currentHandler(event, context);
};
