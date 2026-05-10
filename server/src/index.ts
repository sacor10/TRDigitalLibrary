import { openAnnotationsDb } from './annotations-db.js';
import { createApp } from './app.js';
import { createGoogleVerifier } from './auth/google.js';
import { openLibraryDb } from './db.js';

const PORT = Number(process.env.PORT ?? 3001);

async function main(): Promise<void> {
  const db = await openLibraryDb();

  const annotationsDb = await openAnnotationsDb();
  const sessionSecret =
    process.env.SESSION_SECRET ??
    (process.env.NODE_ENV === 'production'
      ? (() => {
          throw new Error('SESSION_SECRET must be set in production');
        })()
      : 'dev-insecure-session-secret-change-me');
  const googleClientId = process.env.GOOGLE_CLIENT_ID ?? '';

  if (!googleClientId) {
    console.warn(
      '[auth] GOOGLE_CLIENT_ID is not set; /api/auth/google is not registered until configured',
    );
  }

  const app = createApp(db, {
    annotationsDb,
    sessionSecret,
    ...(googleClientId
      ? { verifyGoogleIdToken: createGoogleVerifier(googleClientId) }
      : {}),
  });

  const server = app.listen(PORT, () => {
    console.log(`TR Digital Library API listening on http://localhost:${PORT}`);
  });

  const shutdown = (): void => {
    console.log('Shutting down...');
    server.close(() => {
      db.close();
      annotationsDb.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
