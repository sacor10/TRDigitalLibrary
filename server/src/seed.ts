import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { DocumentSchema } from '@tr/shared';

import { openDatabase, upsertDocument } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SeedFileSchema = z.array(DocumentSchema);

function loadSeedDocuments(): z.infer<typeof SeedFileSchema> {
  const seedPath = join(__dirname, '..', '..', 'data', 'seed.json');
  const raw = readFileSync(seedPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return SeedFileSchema.parse(parsed);
}

function seed(): void {
  const documents = loadSeedDocuments();
  const dbPath = join(__dirname, '..', '..', 'data', 'library.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
  const tx = db.transaction(() => {
    for (const doc of documents) {
      upsertDocument(db, doc);
    }
  });
  tx();
  const count = (db.prepare('SELECT COUNT(*) as c FROM documents').get() as { c: number }).c;
  console.log(`Seeded ${count} documents into ${dbPath}`);
  db.close();
}

seed();
