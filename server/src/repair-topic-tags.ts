import { parseArgs } from 'node:util';

import { openLibraryDb, type LibsqlClient } from './db.js';

const GLOBAL_TOPIC_THRESHOLD = 0.95;
const JUNK_TAGS = new Set(['count', 'title', 'url', 'manuscript/mixed material']);

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

function asNumber(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

function normalizeTag(value: string): string {
  return value.replace(/\.+$/g, '').replace(/\s+/g, ' ').trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(normalizeTag).filter(Boolean))];
}

function parseTags(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(asString(raw));
    return Array.isArray(parsed) ? parsed.flatMap((v) => (typeof v === 'string' ? [v] : [])) : [];
  } catch {
    return [];
  }
}

async function corpusWideTags(db: LibsqlClient): Promise<Set<string>> {
  const totalResult = await db.execute(
    'SELECT COUNT(DISTINCT d.id) AS total FROM documents d, json_each(d.tags) je',
  );
  const total = asNumber(totalResult.rows[0]?.total);
  if (total === 0) return new Set();

  const countsResult = await db.execute(
    `SELECT je.value AS tag,
            COUNT(DISTINCT d.id) AS size
       FROM documents d, json_each(d.tags) je
      GROUP BY je.value`,
  );

  const out = new Set<string>();
  for (const row of countsResult.rows) {
    const tag = normalizeTag(asString(row.tag));
    const size = asNumber(row.size);
    if (tag && size >= total * GLOBAL_TOPIC_THRESHOLD) out.add(tag);
  }
  return out;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(`Usage: npm run repair-topic-tags -- [--dry-run]

Removes tags that cannot represent per-document topics:
  - LoC metadata artifacts (count/title/url/original_format values)
  - tags attached to at least 95% of tagged documents
`);
    return;
  }

  const dryRun = Boolean(values['dry-run']);
  const db = await openLibraryDb();
  try {
    const globalTags = await corpusWideTags(db);
    const docs = await db.execute('SELECT id, tags FROM documents ORDER BY id');

    let changedDocs = 0;
    let removedTags = 0;
    for (const row of docs.rows) {
      const current = parseTags(row.tags);
      const next = unique(
        current.filter((tag) => {
          const normalized = normalizeTag(tag);
          return !JUNK_TAGS.has(normalized.toLowerCase()) && !globalTags.has(normalized);
        }),
      );
      if (JSON.stringify(unique(current)) === JSON.stringify(next)) continue;
      changedDocs += 1;
      removedTags += Math.max(0, unique(current).length - next.length);
      if (!dryRun) {
        await db.execute({
          sql: 'UPDATE documents SET tags = ? WHERE id = ?',
          args: [JSON.stringify(next), asString(row.id)],
        });
      }
    }

    console.log(
      `[repair-topic-tags] ${dryRun ? 'would update' : 'updated'} ${changedDocs} document(s), ` +
        `${dryRun ? 'would remove' : 'removed'} ${removedTags} tag assignment(s).`,
    );
    if (globalTags.size > 0) {
      console.log(
        `[repair-topic-tags] corpus-wide tags removed: ${Array.from(globalTags)
          .sort()
          .slice(0, 25)
          .join(', ')}${globalTags.size > 25 ? ', ...' : ''}`,
      );
    }
  } finally {
    db.close();
  }
}

await main();
