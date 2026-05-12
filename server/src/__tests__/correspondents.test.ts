import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../app.js';
import { openInMemoryDatabase, type LibsqlClient } from '../db.js';
import { createCorrespondentsRouter } from '../routes/correspondents.js';
import { upsertTrcCorrespondenceItems, type TrcCorrespondenceItem } from '../sources/trc.js';

const baseItem = {
  collection: 'Library of Congress Manuscript Division',
  repository: null,
  language: 'English',
  period: null,
  pageCount: '1',
  productionMethod: 'Typed',
  recordType: 'Image',
  rights: 'No known restrictions on publication.',
} satisfies Pick<
  TrcCorrespondenceItem,
  | 'collection'
  | 'repository'
  | 'language'
  | 'period'
  | 'pageCount'
  | 'productionMethod'
  | 'recordType'
  | 'rights'
>;

function person(label: string, slug: string | null = null) {
  return {
    label,
    authoritySlug: slug,
    authorityUrl: slug ? `https://www.theodorerooseveltcenter.org/creator/${slug}/` : null,
  };
}

function item(overrides: Partial<TrcCorrespondenceItem>): TrcCorrespondenceItem {
  return {
    ...baseItem,
    id: 'trc-o1',
    title: 'Letter from Theodore Roosevelt to Frank T. Winslow',
    sourceUrl: 'https://www.theodorerooseveltcenter.org/digital-library/o1/',
    date: '1918-02-28',
    dateDisplay: '1918-02-28',
    resourceType: 'letter',
    creators: [person('Roosevelt, Theodore, 1858-1919', 'roosevelt-theodore-1858-1919')],
    recipients: [person('Winslow, F T', 'winslow-f-t')],
    ...overrides,
  };
}

function createCorrespondentsOnlyApp(db: LibsqlClient) {
  const app = express();
  app.use('/api/correspondents', createCorrespondentsRouter(db));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });
  return app;
}

describe('correspondents API', () => {
  let db: LibsqlClient;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    db = await openInMemoryDatabase();
    await upsertTrcCorrespondenceItems(
      db,
      [
        item({ id: 'trc-o1', sourceUrl: 'https://www.theodorerooseveltcenter.org/digital-library/o1/' }),
        item({
          id: 'trc-o2',
          title: 'Letter from Frank T. Winslow to Theodore Roosevelt',
          sourceUrl: 'https://www.theodorerooseveltcenter.org/digital-library/o2/',
          date: '1918-03-01',
          dateDisplay: '1918-03-01',
          creators: [person('Winslow, F T', 'winslow-f-t')],
          recipients: [person('Roosevelt, Theodore, 1858-1919', 'roosevelt-theodore-1858-1919')],
        }),
        item({
          id: 'trc-o3',
          title: 'Telegram from Theodore Roosevelt to Anna Roosevelt',
          sourceUrl: 'https://www.theodorerooseveltcenter.org/digital-library/o3/',
          date: '1878-02-09',
          dateDisplay: '1878-02-09',
          resourceType: 'telegram',
          recipients: [person('Cowles, Anna Roosevelt, 1855-1931', 'cowles-anna-roosevelt-1855-1931')],
        }),
      ],
      '2026-05-11T12:00:00.000Z',
    );
    await db.execute({
      sql: `INSERT INTO documents
              (id, title, type, date, recipient, author, transcription, source, source_url, tags)
            VALUES
              (@id, @title, @type, @date, @recipient, @author, @transcription, @source, @source_url, @tags)`,
      args: {
        id: 'loc-o2',
        title: 'Letter from Frank T. Winslow to Theodore Roosevelt',
        type: 'letter',
        date: '1918-03-01',
        recipient: 'Theodore Roosevelt',
        author: 'Frank T. Winslow',
        transcription: '',
        source: 'Library of Congress',
        source_url: 'https://www.loc.gov/item/mss382990002/',
        tags: '[]',
      },
    });
    app = createApp(db);
  });

  afterAll(() => {
    db.close();
  });

  it('returns aggregate graph nodes and direction counts', async () => {
    const res = await request(app).get('/api/correspondents/graph?minLetters=1&limit=10');

    expect(res.status).toBe(200);
    expect(res.body.totalItems).toBe(3);
    expect(res.body.edges).toHaveLength(2);
    const winslow = res.body.nodes.find((node: { id: string }) => node.id === 'winslow-f-t');
    expect(winslow).toMatchObject({
      label: 'Winslow, F T',
      totalCount: 2,
      inboundCount: 1,
      outboundCount: 1,
      firstDate: '1918-02-28',
      lastDate: '1918-03-01',
    });
    const edge = res.body.edges.find((e: { target: string }) => e.target === 'winslow-f-t');
    expect(edge).toMatchObject({ totalCount: 2, fromTrCount: 1, toTrCount: 1 });
  });

  it('filters graph direction and text query', async () => {
    const res = await request(app).get('/api/correspondents/graph?direction=from-tr&q=Anna');

    expect(res.status).toBe(200);
    expect(res.body.edges).toHaveLength(1);
    expect(res.body.edges[0]).toMatchObject({
      target: 'cowles-anna-roosevelt-1855-1931',
      totalCount: 1,
      fromTrCount: 1,
      toTrCount: 0,
    });
  });

  it('returns paginated items for one correspondent', async () => {
    const res = await request(app).get('/api/correspondents/winslow-f-t/items?direction=to-tr');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      id: 'trc-o2',
      documentId: 'loc-o2',
      title: 'Letter from Frank T. Winslow to Theodore Roosevelt',
      sourceUrl: 'https://www.theodorerooseveltcenter.org/digital-library/o2/',
    });
    expect(res.body.items[0].creators[0]).toMatchObject({
      id: 'winslow-f-t',
      rawName: 'Winslow, F T',
    });
  });

  it('rejects malformed graph filters', async () => {
    const res = await request(app).get('/api/correspondents/graph?limit=9999');
    expect(res.status).toBe(400);
  });

  it('binds only graph query parameters used by each statement', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total_items: 0, total_correspondents: 0 }] });
    const routerApp = createCorrespondentsOnlyApp({ execute } as unknown as LibsqlClient);

    const res = await request(routerApp).get(
      '/api/correspondents/graph?dateFrom=1900-01-01&q=Anna&minLetters=2&limit=7',
    );

    expect(res.status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      args: {
        tr: 'theodore-roosevelt',
        date_from: '1900-01-01',
        q: '%Anna%',
        min_letters: 2,
        limit: 7,
      },
    });
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      args: {
        tr: 'theodore-roosevelt',
        date_from: '1900-01-01',
        q: '%Anna%',
      },
    });
    expect(execute.mock.calls[1]?.[0]?.args).not.toHaveProperty('min_letters');
    expect(execute.mock.calls[1]?.[0]?.args).not.toHaveProperty('limit');
  });

  it('binds pagination only on the items listing query', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });
    const routerApp = createCorrespondentsOnlyApp({ execute } as unknown as LibsqlClient);

    const res = await request(routerApp).get(
      '/api/correspondents/winslow-f-t/items?direction=to-tr&dateFrom=1900-01-01&limit=5&offset=10',
    );

    expect(res.status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      args: {
        tr: 'theodore-roosevelt',
        person_id: 'winslow-f-t',
        date_from: '1900-01-01',
      },
    });
    expect(execute.mock.calls[0]?.[0]?.args).not.toHaveProperty('limit');
    expect(execute.mock.calls[0]?.[0]?.args).not.toHaveProperty('offset');
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      args: {
        tr: 'theodore-roosevelt',
        person_id: 'winslow-f-t',
        date_from: '1900-01-01',
        limit: 5,
        offset: 10,
      },
    });
  });
});
