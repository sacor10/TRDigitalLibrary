import type {
  CorrespondentEdge,
  CorrespondentGraphResponse,
  CorrespondentLetter,
  CorrespondentNode,
} from '@tr/shared';
import { Router } from 'express';


import type { LibsqlClient } from '../db.js';

const TR_NODE_ID = 'theodore-roosevelt';
const TR_NODE_LABEL = 'Theodore Roosevelt';

interface LetterRow {
  id: string;
  title: string;
  date: string;
  recipient: string | null;
  mentions: string;
}

function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed;
}

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

function asNullableString(v: unknown): string | null {
  return v == null ? null : String(v);
}

export function createCorrespondentsRouter(db: LibsqlClient): Router {
  const router = Router();

  router.get('/graph', async (_req, res) => {
    const result = await db.execute(
      `SELECT id, title, date, recipient, mentions
         FROM documents
         WHERE type = 'letter'
         ORDER BY date ASC`,
    );
    const rows: LetterRow[] = result.rows.map((row) => ({
      id: asString(row.id),
      title: asString(row.title),
      date: asString(row.date),
      recipient: asNullableString(row.recipient),
      mentions: asString(row.mentions),
    }));

    const nodes = new Map<string, CorrespondentNode>();
    const edges = new Map<string, CorrespondentEdge>();
    const letters: CorrespondentLetter[] = [];

    nodes.set(TR_NODE_ID, {
      id: TR_NODE_ID,
      label: TR_NODE_LABEL,
      letterCount: 0,
      isTR: true,
    });

    for (const row of rows) {
      const mentionsList = (JSON.parse(row.mentions) as string[])
        .map(normalizeName)
        .filter((n): n is string => n !== null);
      const recipientName = row.recipient ? normalizeName(row.recipient) : null;

      const participantIds = new Set<string>([TR_NODE_ID]);

      const addParticipant = (label: string): string => {
        const id = slugify(label);
        if (!id) return '';
        const existing = nodes.get(id);
        if (existing) {
          existing.letterCount += 1;
        } else {
          nodes.set(id, { id, label, letterCount: 1, isTR: false });
        }
        participantIds.add(id);
        return id;
      };

      if (recipientName) {
        addParticipant(recipientName);
      }
      for (const mention of mentionsList) {
        addParticipant(mention);
      }

      const trNode = nodes.get(TR_NODE_ID);
      if (trNode) trNode.letterCount += 1;

      const ids = Array.from(participantIds);
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const a = ids[i]!;
          const b = ids[j]!;
          const source = a < b ? a : b;
          const target = a < b ? b : a;
          const key = `${source}||${target}`;
          const existing = edges.get(key);
          if (existing) {
            existing.letterIds.push(row.id);
          } else {
            edges.set(key, { source, target, letterIds: [row.id] });
          }
        }
      }

      letters.push({
        id: row.id,
        title: row.title,
        date: row.date,
        recipient: recipientName,
        mentions: mentionsList,
        participantIds: ids,
      });
    }

    const payload: CorrespondentGraphResponse = {
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
      letters,
    };
    return res.json(payload);
  });

  return router;
}
