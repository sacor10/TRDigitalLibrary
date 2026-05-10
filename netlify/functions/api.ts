import { join } from 'node:path';

import serverless from 'serverless-http';

import { createApp } from '../../server/src/app.js';
import { openDatabase } from '../../server/src/db.js';

const DB_PATH =
  process.env.LIBRARY_DB_PATH ??
  join(process.env.LAMBDA_TASK_ROOT ?? process.cwd(), 'data', 'library.db');

const db = openDatabase(DB_PATH, { readonly: true });
const app = createApp(db, { readonly: true, corsOrigins: [] });

export const handler = serverless(app);
