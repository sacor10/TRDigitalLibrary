import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openInMemoryDatabase, runMigrations, type LibsqlClient } from '../db.js';

// Regression guard for a Netlify 502. Every cold start of the serverless
// function calls openLibraryDb -> runMigrations, which used to fire one
// SELECT per migration file (10+ sequential round-trips to Turso). At edge
// latency that pushed the first request past the function's 502 threshold
// even after the list endpoint was paginated. The hot-path migration probe
// must now stay O(1) round-trips regardless of how many migrations exist.
describe('runMigrations on a fully-applied DB', () => {
  let db: LibsqlClient;
  let migrationCount: number;

  beforeAll(async () => {
    db = await openInMemoryDatabase();
    const rs = await db.execute('SELECT COUNT(*) AS c FROM schema_migrations');
    migrationCount = Number(rs.rows[0]?.c ?? 0);
    expect(migrationCount).toBeGreaterThan(1);
  });

  afterAll(() => {
    db.close();
  });

  it('issues a bounded number of queries when every migration is already applied', async () => {
    let executeCount = 0;
    let executeMultipleCount = 0;
    const counting = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'execute') {
          return async (...args: Parameters<LibsqlClient['execute']>) => {
            executeCount += 1;
            return (target.execute as LibsqlClient['execute'])(...args);
          };
        }
        if (prop === 'executeMultiple') {
          return async (...args: Parameters<LibsqlClient['executeMultiple']>) => {
            executeMultipleCount += 1;
            return (target.executeMultiple as LibsqlClient['executeMultiple'])(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as LibsqlClient;

    await runMigrations(counting);

    // Expected hot path on an already-migrated DB:
    //   1) CREATE TABLE IF NOT EXISTS schema_migrations
    //   2) Single batched SELECT id FROM schema_migrations WHERE id IN (...)
    // executeMultiple is reserved for applying NEW migrations and must not
    // fire on a fully-applied DB.
    expect(executeMultipleCount).toBe(0);
    expect(executeCount).toBeLessThanOrEqual(3);
    expect(executeCount).toBeLessThan(migrationCount);
  });
});
