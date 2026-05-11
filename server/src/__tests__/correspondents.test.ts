import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { openInMemoryDatabase, type LibsqlClient } from '../db.js';
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
});
