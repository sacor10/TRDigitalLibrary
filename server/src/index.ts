import { createApp } from './app.js';
import { openDatabase } from './db.js';

const PORT = Number(process.env.PORT ?? 3001);

const db = openDatabase();
const app = createApp(db);

const server = app.listen(PORT, () => {
  console.log(`TR Digital Library API listening on http://localhost:${PORT}`);
});

const shutdown = (): void => {
  console.log('Shutting down...');
  server.close(() => {
    db.close();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
