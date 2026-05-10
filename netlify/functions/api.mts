import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import serverless from 'serverless-http';

import { openAnnotationsDb } from '../../server/src/annotations-db.js';
import { createApp } from '../../server/src/app.js';
import { createGoogleVerifier } from '../../server/src/auth/google.js';
import { openDatabase } from '../../server/src/db.js';

const TASK_ROOT = process.env.LAMBDA_TASK_ROOT ?? process.cwd();

const SOURCE_DB =
  process.env.LIBRARY_DB_PATH ?? join(TASK_ROOT, 'data', 'library.db');

// Lambda's task root is read-only. SQLite (especially in WAL mode) needs to
// write sidecar files (.wal/.shm) even for SELECTs, so copy the seeded DB into
// /tmp on cold start and open from there.
const DB_PATH = '/tmp/library.db';
if (!existsSync(DB_PATH)) {
  copyFileSync(SOURCE_DB, DB_PATH);
}

const db = openDatabase(DB_PATH, { readonly: true });

// Annotations + auth live in a separate writable backend (Turso/libSQL in prod,
// local file in dev). When SESSION_SECRET is unset, the auth/annotation routes
// are not registered, but the read-only document API continues to work.
//
// The migrations directory lives at <task-root>/server/src/annotations-migrations/
// (see netlify.toml `included_files`). We resolve it explicitly because, once
// bundled, `import.meta.url` inside annotations-db.ts points at the bundle
// rather than the original source path.
const sessionSecret = process.env.SESSION_SECRET;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const annotationsMigrationsDir = join(
  TASK_ROOT,
  'server',
  'src',
  'annotations-migrations',
);

let annotationsDb: Awaited<ReturnType<typeof openAnnotationsDb>> | undefined;
if (sessionSecret) {
  try {
    annotationsDb = await openAnnotationsDb({
      migrationsDir: annotationsMigrationsDir,
    });
  } catch (err) {
    // Don't take down the read-only document API if the annotations backend
    // can't initialize — log and continue without auth/annotation routes.
    console.error('Failed to initialize annotations DB:', err);
  }
}

const app = createApp(db, {
  readonly: true,
  corsOrigins: [],
  ...(annotationsDb && sessionSecret
    ? {
        annotationsDb,
        sessionSecret,
        ...(googleClientId
          ? { verifyGoogleIdToken: createGoogleVerifier(googleClientId) }
          : {}),
      }
    : {}),
});

export const handler = serverless(app);
