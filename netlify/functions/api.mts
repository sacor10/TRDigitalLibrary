import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import serverless from 'serverless-http';

import { createApp } from '../../server/src/app.js';
import { openDatabase } from '../../server/src/db.js';

const SOURCE_DB =
  process.env.LIBRARY_DB_PATH ??
  join(process.env.LAMBDA_TASK_ROOT ?? process.cwd(), 'data', 'library.db');

// Lambda's task root is read-only. SQLite (especially in WAL mode) needs to
// write sidecar files (.wal/.shm) even for SELECTs, so copy the seeded DB into
// /tmp on cold start and open from there.
const DB_PATH = '/tmp/library.db';
if (!existsSync(DB_PATH)) {
  copyFileSync(SOURCE_DB, DB_PATH);
}

const db = openDatabase(DB_PATH, { readonly: true });
const app = createApp(db, { readonly: true, corsOrigins: [] });

export const handler = serverless(app);
