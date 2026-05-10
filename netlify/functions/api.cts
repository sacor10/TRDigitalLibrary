import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

import serverless from 'serverless-http';

import { createApp } from '../../server/src/app.js';
import { openLibraryDb } from '../../server/src/db.js';

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
  // TODO(commit 5): rewrite this to connect directly to Turso via
  // TURSO_LIBRARY_DATABASE_URL + TURSO_LIBRARY_AUTH_TOKEN. For now, preserve
  // the bundled-DB-on-/tmp behaviour so the function still works during the
  // async-conversion commit.
  const tursoLibraryUrl = process.env.TURSO_LIBRARY_DATABASE_URL;
  const tursoLibraryAuthToken = process.env.TURSO_LIBRARY_AUTH_TOKEN;

  let db;
  if (tursoLibraryUrl) {
    db = await openLibraryDb({
      url: tursoLibraryUrl,
      ...(tursoLibraryAuthToken ? { authToken: tursoLibraryAuthToken } : {}),
    });
  } else {
    // Fallback: copy the bundled SQLite DB into /tmp (Lambda's writable area)
    // and open it via libsql's file: URL.
    copyFileSync(sourceDbPath(), TMP_DB_PATH);
    db = await openLibraryDb({ url: `file:${TMP_DB_PATH}` });
  }

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
