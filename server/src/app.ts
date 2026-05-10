import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import type { Database as DatabaseT } from 'better-sqlite3';

import type { LibsqlClient } from './annotations-db.js';
import type { GoogleVerifier } from './auth/google.js';
import { loadUser } from './middleware/requireUser.js';
import { buildOpenApiDocument } from './openapi.js';
import {
  createAnnotationsRouter,
  createDocumentAnnotationsRouter,
} from './routes/annotations.js';
import { createAuthRouter } from './routes/auth.js';
import { createCorrespondentsRouter } from './routes/correspondents.js';
import { createDocumentsRouter } from './routes/documents.js';
import { createSearchRouter } from './routes/search.js';
import { createSentimentRouter } from './routes/sentiment.js';
import { createTopicsRouter } from './routes/topics.js';

export interface CreateAppOptions {
  readonly?: boolean;
  corsOrigins?: string[];
  annotationsDb?: LibsqlClient;
  verifyGoogleIdToken?: GoogleVerifier;
  sessionSecret?: string;
}

export function createApp(db: DatabaseT, opts: CreateAppOptions = {}): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: opts.corsOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/openapi.json', (_req, res) => res.json(buildOpenApiDocument()));

  if (opts.annotationsDb && opts.sessionSecret) {
    app.use(loadUser({ annotationsDb: opts.annotationsDb, sessionSecret: opts.sessionSecret }));
    app.use(
      '/api/auth',
      createAuthRouter({
        annotationsDb: opts.annotationsDb,
        sessionSecret: opts.sessionSecret,
        ...(opts.verifyGoogleIdToken
          ? { verifyGoogleIdToken: opts.verifyGoogleIdToken }
          : {}),
      }),
    );
    app.use(
      '/api/annotations',
      createAnnotationsRouter({
        documentsDb: db,
        annotationsDb: opts.annotationsDb,
      }),
    );
    app.use(
      '/api/documents/:id/annotations',
      createDocumentAnnotationsRouter({
        documentsDb: db,
        annotationsDb: opts.annotationsDb,
      }),
    );
  } else {
    app.get('/api/auth/me', (_req, res) => {
      res.status(401).json({ error: 'Not signed in' });
    });
  }

  app.use('/api/documents', createDocumentsRouter(db, { readonly: opts.readonly }));
  app.use('/api/search', createSearchRouter(db));
  app.use('/api/correspondents', createCorrespondentsRouter(db));
  app.use('/api/topics', createTopicsRouter(db));
  app.use('/api/sentiment', createSentimentRouter(db));

  app.use((req, res) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
  });

  return app;
}
