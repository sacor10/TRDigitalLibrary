import { afterEach, describe, expect, it } from 'vitest';

import { openInMemoryDatabase, type LibsqlClient } from '../db.js';
import {
  parseTrcSearchPage,
  upsertTrcCorrespondenceItems,
  type TrcCorrespondenceItem,
} from '../sources/trc.js';

const searchFixture = `
<!doctype html>
<html>
  <head><link rel="next" href="https://www.theodorerooseveltcenter.org/digital-library/page/2/" /></head>
  <body>
    <div class="digital-library-options"><p class="h3">3 Results</p></div>
    <article class="tease tease-digital-library">
      <h2 class="h4 tease-title"><a href="https://www.theodorerooseveltcenter.org/digital-library/o252899/">Letter from Theodore Roosevelt to Frank T. Winslow</a></h2>
      <div class="tease-text">
        <h3 class="wp-block-heading">Collection</h3><p>Library of Congress Manuscript Division</p>
        <h3 class="wp-block-heading">Creation Date</h3><p>1918-02-28</p>
        <h3 class="wp-block-heading">Creator(s)</h3><p><a href="https://www.theodorerooseveltcenter.org/creator/roosevelt-theodore-1858-1919/">Roosevelt, Theodore, 1858-1919</a></p>
        <h3 class="wp-block-heading">Recipient</h3><p><a href="https://www.theodorerooseveltcenter.org/recipient/winslow-f-t/">Winslow, F T</a></p>
        <h3 class="wp-block-heading">Resource Type</h3><p>Letter</p>
      </div>
    </article>
    <article class="tease tease-digital-library">
      <h2 class="h4 tease-title"><a href="/digital-library/o278238/">Telegram from Theodore Roosevelt to Anna Roosevelt</a></h2>
      <div class="tease-text">
        <h3 class="wp-block-heading">Creation Date</h3><p>1878-02</p>
        <h3 class="wp-block-heading">Creator(s)</h3><p>Roosevelt, Theodore, 1858-1919</p>
        <h3 class="wp-block-heading">Recipient</h3><p><a href="/recipient/cowles-anna-roosevelt-1855-1931/">Cowles, Anna Roosevelt, 1855-1931</a></p>
        <h3 class="wp-block-heading">Resource Type</h3><p>Telegram</p>
      </div>
    </article>
    <article class="tease tease-digital-library">
      <h2 class="h4 tease-title"><a href="/digital-library/o247097/">Letter from Secretary of Theodore Roosevelt to True Whittier</a></h2>
      <div class="tease-text">
        <h3 class="wp-block-heading">Creator(s)</h3><p><a href="/creator/secretary-of-theodore-roosevelt/">Secretary of Theodore Roosevelt</a></p>
        <h3 class="wp-block-heading">Recipient</h3><p>Whittier, True; Pearson, Gus</p>
        <h3 class="wp-block-heading">Resource Type</h3><p>Letter</p>
      </div>
    </article>
  </body>
</html>`;

describe('TRC correspondence ingest helpers', () => {
  let db: LibsqlClient | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('parses expanded TRC result cards with authority links, partial dates, and missing fields', () => {
    const page = parseTrcSearchPage(searchFixture, 'letter');

    expect(page.total).toBe(3);
    expect(page.hasNext).toBe(true);
    expect(page.items).toHaveLength(3);
    expect(page.items[0]?.id).toBe('trc-o252899');
    expect(page.items[0]?.date).toBe('1918-02-28');
    expect(page.items[0]?.creators[0]?.authoritySlug).toBe('roosevelt-theodore-1858-1919');
    expect(page.items[1]?.resourceType).toBe('telegram');
    expect(page.items[1]?.date).toBe('1878-02-01');
    expect(page.items[2]?.date).toBeNull();
    expect(page.items[2]?.recipients.map((p) => p.label)).toEqual([
      'Whittier, True',
      'Pearson, Gus',
    ]);
  });

  it('splits natural-language no-link participant lists without splitting inverted names', () => {
    const page = parseTrcSearchPage(
      `<article class="tease tease-digital-library">
        <h2 class="h4 tease-title"><a href="/digital-library/o100/">Letter from Theodore Roosevelt to Family</a></h2>
        <div class="tease-text">
          <h3 class="wp-block-heading">Creator(s)</h3><p>Roosevelt, Theodore, 1858-1919</p>
          <h3 class="wp-block-heading">Recipient</h3><p>Martha Bulloch Roosevelt, Corinne Roosevelt Robinson, and Theodore Roosevelt</p>
        </div>
      </article>`,
      'letter',
    );

    expect(page.items[0]?.creators.map((p) => p.label)).toEqual([
      'Roosevelt, Theodore, 1858-1919',
    ]);
    expect(page.items[0]?.recipients.map((p) => p.label)).toEqual([
      'Martha Bulloch Roosevelt',
      'Corinne Roosevelt Robinson',
      'Theodore Roosevelt',
    ]);
  });

  it('falls back to title-derived participants when result card fields omit them', () => {
    const page = parseTrcSearchPage(
      `<article class="tease tease-digital-library">
        <h2 class="h4 tease-title"><a href="/digital-library/o287345/">Letter from Theodore Roosevelt to Dora Watkins</a></h2>
        <div class="tease-text">
          <h3 class="wp-block-heading">Creation Date</h3><p>1867-06-06</p>
        </div>
      </article>`,
      'letter',
    );

    expect(page.items[0]?.creators[0]?.label).toBe('Theodore Roosevelt');
    expect(page.items[0]?.recipients[0]?.label).toBe('Dora Watkins');
  });

  it('upserts normalized correspondents and participants idempotently', async () => {
    db = await openInMemoryDatabase();
    const items = parseTrcSearchPage(searchFixture, 'letter').items;

    await upsertTrcCorrespondenceItems(db, items, '2026-05-11T12:00:00.000Z');
    await upsertTrcCorrespondenceItems(db, items, '2026-05-11T12:05:00.000Z');

    const correspondents = await db.execute('SELECT id, label, is_tr FROM correspondents ORDER BY id');
    expect(correspondents.rows.some((row) => row.id === 'theodore-roosevelt')).toBe(true);
    const trRows = correspondents.rows.filter((row) => row.id === 'theodore-roosevelt');
    expect(trRows).toHaveLength(1);
    expect(Number(trRows[0]?.is_tr)).toBe(1);

    const itemsCount = await db.execute('SELECT COUNT(*) AS c FROM correspondence_items');
    expect(Number(itemsCount.rows[0]?.c)).toBe(3);

    const participants = await db.execute({
      sql: `SELECT COUNT(*) AS c
            FROM correspondence_participants
            WHERE item_id = ? AND role = 'recipient'`,
      args: ['trc-o247097'],
    });
    expect(Number(participants.rows[0]?.c)).toBe(2);
  });

  it('skips items without both creator and recipient participants on upsert', async () => {
    db = await openInMemoryDatabase();
    const incomplete: TrcCorrespondenceItem = {
      ...parseTrcSearchPage(searchFixture, 'letter').items[0]!,
      id: 'trc-incomplete',
      sourceUrl: 'https://www.theodorerooseveltcenter.org/digital-library/o999999/',
      recipients: [],
    };

    await upsertTrcCorrespondenceItems(db, [incomplete], '2026-05-11T12:00:00.000Z');

    const count = await db.execute('SELECT COUNT(*) AS c FROM correspondence_items');
    expect(Number(count.rows[0]?.c)).toBe(0);
  });
});
