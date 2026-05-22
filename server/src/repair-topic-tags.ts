import { parseArgs } from 'node:util';

import { openLibraryDb, type LibsqlClient } from './db.js';

const GLOBAL_TOPIC_THRESHOLD = 0.95;
const JUNK_TAGS = new Set(['count', 'title', 'url', 'manuscript/mixed material']);
const MAX_TOPICS_PER_DOCUMENT = 6;

interface TopicPattern {
  label: string;
  terms: RegExp[];
}

const CONTENT_TOPICS: TopicPattern[] = [
  {
    label: 'Civil service',
    terms: [/civil service/g, /appointment/g, /appoint(?:ed|ment|ments)/g, /postmaster/g],
  },
  {
    label: 'Politics and elections',
    terms: [/election/g, /campaign/g, /republican/g, /democrat/g, /party/g, /congress/g],
  },
  {
    label: 'Government and legislation',
    terms: [/bill/g, /committee/g, /senate/g, /house of representatives/g, /legislation/g],
  },
  {
    label: 'Education',
    terms: [/school/g, /college/g, /university/g, /student/g, /teacher/g, /education/g],
  },
  {
    label: 'Veterans and pensions',
    terms: [/veteran/g, /pension/g, /grand army/g, /g\.?\s*a\.?\s*r\.?/g, /union soldier/g],
  },
  {
    label: 'Military affairs',
    terms: [/army/g, /military/g, /war department/g, /soldier/g, /colonel/g, /regiment/g],
  },
  {
    label: 'Navy and shipping',
    terms: [/navy/g, /naval/g, /ship/g, /shipping/g, /harbor/g, /merchant marine/g],
  },
  {
    label: 'Law and courts',
    terms: [/court/g, /judge/g, /lawyer/g, /counsellor/g, /attorney/g, /legal/g],
  },
  {
    label: 'Labor and unions',
    terms: [/labor/g, /union/g, /strike/g, /working men/g, /workmen/g, /wages/g],
  },
  {
    label: 'Business and finance',
    terms: [/business/g, /bank/g, /money/g, /fund/g, /company/g, /corporation/g, /insurance/g],
  },
  {
    label: 'Religion and churches',
    terms: [/church/g, /minister/g, /bishop/g, /mission/g, /christian/g, /religious/g],
  },
  {
    label: 'Public health',
    terms: [/hospital/g, /doctor/g, /medical/g, /health/g, /disease/g, /sanitary/g],
  },
  {
    label: 'Press and publishing',
    terms: [/newspaper/g, /editor/g, /magazine/g, /article/g, /press/g, /publisher/g],
  },
  {
    label: 'Foreign affairs',
    terms: [/ambassador/g, /treaty/g, /foreign/g, /diplomatic/g, /japan/g, /china/g, /europe/g],
  },
  {
    label: 'Conservation',
    terms: [/conservation/g, /forest/g, /national park/g, /wildlife/g, /game preserve/g],
  },
  {
    label: 'Charity and relief',
    terms: [/charity/g, /relief/g, /donation/g, /aid society/g, /orphan/g, /poor/g],
  },
  {
    label: 'Speeches and invitations',
    terms: [/address/g, /speech/g, /invitation/g, /lecture/g, /banquet/g, /dinner/g],
  },
  {
    label: 'Books and manuscripts',
    terms: [/book/g, /manuscript/g, /autograph/g, /library/g, /letter and portrait/g],
  },
  {
    label: 'Agriculture and rural life',
    terms: [/farm/g, /farmer/g, /agriculture/g, /ranch/g, /crop/g, /rural/g],
  },
  {
    label: 'Railroads and transportation',
    terms: [/railroad/g, /railway/g, /transportation/g, /train/g, /canal/g],
  },
];

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

function textForTopicScan(title: unknown, transcription: unknown): string {
  return `${asString(title)}\n${asString(transcription)}`
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, ' ');
}

function countMatches(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(pattern)).length;
}

function computeContentTopics(title: unknown, transcription: unknown): string[] {
  const text = textForTopicScan(title, transcription);
  const scored = CONTENT_TOPICS.map((topic) => ({
    label: topic.label,
    score: topic.terms.reduce((sum, term) => sum + countMatches(text, term), 0),
  }))
    .filter((topic) => topic.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return scored.slice(0, MAX_TOPICS_PER_DOCUMENT).map((topic) => topic.label);
}

function parseTags(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(asString(raw));
    return Array.isArray(parsed) ? parsed.flatMap((v) => (typeof v === 'string' ? [v] : [])) : [];
  } catch {
    return [];
  }
}

function corpusWideTagsFromDocuments(docs: Array<{ tags: string[] }>): Set<string> {
  const taggedDocs = docs.filter((doc) => doc.tags.length > 0);
  const total = taggedDocs.length;
  if (total === 0) return new Set();
  const counts = new Map<string, number>();
  for (const doc of taggedDocs) {
    for (const tag of new Set(doc.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const out = new Set<string>();
  for (const [tag, size] of counts) {
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

Calculates and repairs per-document topic tags:
  - LoC metadata artifacts (count/title/url/original_format values)
  - content-derived topics from document titles/transcriptions
  - removal of tags attached to at least 95% of tagged documents
`);
    return;
  }

  const dryRun = Boolean(values['dry-run']);
  const db = await openLibraryDb();
  try {
    const rows = await db.execute('SELECT id, title, transcription, tags FROM documents ORDER BY id');
    const candidates = rows.rows.map((row) => ({
      id: asString(row.id),
      tags: unique([
        ...parseTags(row.tags).filter((tag) => !JUNK_TAGS.has(normalizeTag(tag).toLowerCase())),
        ...computeContentTopics(row.title, row.transcription),
      ]),
    }));
    const globalTags = corpusWideTagsFromDocuments(candidates);

    let changedDocs = 0;
    let writtenAssignments = 0;
    for (const row of rows.rows) {
      const current = unique(parseTags(row.tags));
      const candidate = candidates.find((doc) => doc.id === asString(row.id));
      const next = (candidate?.tags ?? []).filter((tag) => !globalTags.has(tag));
      if (JSON.stringify(unique(current)) === JSON.stringify(next)) continue;
      changedDocs += 1;
      writtenAssignments += next.length;
      if (!dryRun) {
        await db.execute({
          sql: 'UPDATE documents SET tags = ? WHERE id = ?',
          args: [JSON.stringify(next), asString(row.id)],
        });
      }
    }

    console.log(
      `[repair-topic-tags] ${dryRun ? 'would update' : 'updated'} ${changedDocs} document(s), ` +
        `${dryRun ? 'would write' : 'wrote'} ${writtenAssignments} topic assignment(s).`,
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
