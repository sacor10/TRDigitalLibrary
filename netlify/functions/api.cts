import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import serverless from 'serverless-http';

import { createApp } from '../../server/src/app.js';
import { openDatabase } from '../../server/src/db.js';

type ServerlessHandler = ReturnType<typeof serverless>;

const TMP_DB_PATH = '/tmp/library.db';

let handlerPromise: Promise<ServerlessHandler> | undefined;

function sourceDbPath(): string {
  return (
    process.env.LIBRARY_DB_PATH ??
    join(process.env.LAMBDA_TASK_ROOT ?? process.cwd(), 'data', 'library.db')
  );
}

async function createHandler(): Promise<ServerlessHandler> {
  // Lambda's task root is read-only. SQLite (especially in WAL mode) needs to
  // write sidecar files (.wal/.shm) even for SELECTs, so copy the seeded DB into
  // /tmp on cold start and open from there.
  if (!existsSync(TMP_DB_PATH)) {
    copyFileSync(sourceDbPath(), TMP_DB_PATH);
  }

  const db = openDatabase(TMP_DB_PATH, { readonly: true });
  const sessionSecret = process.env.SESSION_SECRET;
  const tursoDatabaseUrl = process.env.TURSO_DATABASE_URL;
  const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;
  const googleClientId = process.env.GOOGLE_CLIENT_ID;

  // Auth and annotations need a writable production store. If either required
  // piece is missing, keep the read-only document API online and leave auth off.
  let annotationsOptions = {};
  if (sessionSecret && tursoDatabaseUrl) {
    const [{ openAnnotationsDb }, { createGoogleVerifier }] = await Promise.all([
      import('../../server/src/annotations-db.js'),
      import('../../server/src/auth/google.js'),
    ]);
    const annotationsDb = await openAnnotationsDb({
      url: tursoDatabaseUrl,
      ...(tursoAuthToken ? { authToken: tursoAuthToken } : {}),
    });

    annotationsOptions = {
      annotationsDb,
      sessionSecret,
      ...(googleClientId ? { verifyGoogleIdToken: createGoogleVerifier(googleClientId) } : {}),
    };
  }

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
