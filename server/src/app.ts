import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import type { Database as DatabaseT } from 'better-sqlite3';

import { buildOpenApiDocument } from './openapi.js';
import { createCorrespondentsRouter } from './routes/correspondents.js';
import { createDocumentsRouter } from './routes/documents.js';
import { createSearchRouter } from './routes/search.js';

export function createApp(db: DatabaseT): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    }),
  );
  app.use(express.json());
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/openapi.json', (_req, res) => res.json(buildOpenApiDocument()));

  app.use('/api/documents', createDocumentsRouter(db));
  app.use('/api/search', createSearchRouter(db));
  app.use('/api/correspondents', createCorrespondentsRouter(db));

  app.use((req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  });

  return app;
}
