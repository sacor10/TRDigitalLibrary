import type { InValue, Row } from '@libsql/client';
import {
  CorrespondentGraphQuerySchema,
  CorrespondentItemsQuerySchema,
  type CorrespondentEdge,
  type CorrespondentGraphResponse,
  type CorrespondentItem,
  type CorrespondentItemsResponse,
  type CorrespondentNode,
} from '@tr/shared';
import { Router } from 'express';
import type { Request, Response } from 'express';

import type { LibsqlClient } from '../db.js';

const TR_NODE_ID = 'theodore-roosevelt';
const TR_NODE_LABEL = 'Theodore Roosevelt';

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

function asNullableString(v: unknown): string | null {
  return v == null ? null : String(v);
}

function asNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mergeFirst(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function mergeLast(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

interface NodeAccumulator {
  id: string;
  label: string;
  totalCount: number;
  inboundCount: number;
  outboundCount: number;
  firstDate: string | null;
  lastDate: string | null;
  isTR: boolean;
}

interface EdgeRow {
  source: string;
  target: string;
  sourceLabel: string;
  targetLabel: string;
  totalCount: number;
  fromTrCount: number;
  toTrCount: number;
  firstDate: string | null;
  lastDate: string | null;
}

function edgeRow(row: Row): EdgeRow {
  return {
    source: asString(row.source),
    target: asString(row.target),
    sourceLabel: asString(row.source_label),
    targetLabel: asString(row.target_label),
    totalCount: asNumber(row.total_count),
    fromTrCount: asNumber(row.from_tr_count),
    toTrCount: asNumber(row.to_tr_count),
    firstDate: asNullableString(row.first_date),
    lastDate: asNullableString(row.last_date),
  };
}

function addNode(
  nodes: Map<string, NodeAccumulator>,
  id: string,
  label: string,
  isTR: boolean,
): NodeAccumulator {
  const existing = nodes.get(id);
  if (existing) return existing;
  const node: NodeAccumulator = {
    id,
    label: isTR ? TR_NODE_LABEL : label,
    totalCount: 0,
    inboundCount: 0,
    outboundCount: 0,
    firstDate: null,
    lastDate: null,
    isTR,
  };
  nodes.set(id, node);
  return node;
}

function nodeFromAccumulator(node: NodeAccumulator): CorrespondentNode {
  return {
    id: node.id,
    label: node.label,
    totalCount: node.totalCount,
    inboundCount: node.inboundCount,
    outboundCount: node.outboundCount,
    firstDate: node.firstDate,
    lastDate: node.lastDate,
    isTR: node.isTR,
  };
}

function pairRowsCte(whereSql: string): string {
  return `WITH edge_rows AS (
    SELECT
      i.id AS item_id,
      i.date AS date,
      CASE
        WHEN cp.correspondent_id = @tr THEN cp.correspondent_id
        ELSE rp.correspondent_id
      END AS source,
      CASE
        WHEN cp.correspondent_id = @tr THEN rp.correspondent_id
        ELSE cp.correspondent_id
      END AS target,
      CASE
        WHEN cp.correspondent_id = @tr THEN cc.label
        ELSE rc.label
      END AS source_label,
      CASE
        WHEN cp.correspondent_id = @tr THEN rc.label
        ELSE cc.label
      END AS target_label,
      CASE WHEN cp.correspondent_id = @tr THEN 1 ELSE 0 END AS from_tr,
      CASE WHEN rp.correspondent_id = @tr THEN 1 ELSE 0 END AS to_tr
    FROM correspondence_items i
    JOIN correspondence_participants cp
      ON cp.item_id = i.id AND cp.role = 'creator'
    JOIN correspondence_participants rp
      ON rp.item_id = i.id AND rp.role = 'recipient'
    JOIN correspondents cc ON cc.id = cp.correspondent_id
    JOIN correspondents rc ON rc.id = rp.correspondent_id
    WHERE ${whereSql}
  )`;
}

function graphWhere(
  query: ReturnType<typeof CorrespondentGraphQuerySchema.parse>,
): { where: string[]; params: Record<string, InValue> } {
  const where = [
    'cp.correspondent_id <> rp.correspondent_id',
    '(cp.correspondent_id = @tr OR rp.correspondent_id = @tr)',
  ];
  const params: Record<string, InValue> = { tr: TR_NODE_ID };
  if (query.direction === 'from-tr') where.push('cp.correspondent_id = @tr');
  if (query.direction === 'to-tr') where.push('rp.correspondent_id = @tr');
  if (query.dateFrom) {
    where.push('i.date >= @date_from');
    params.date_from = query.dateFrom;
  }
  if (query.dateTo) {
    where.push('i.date <= @date_to');
    params.date_to = query.dateTo;
  }
  if (query.q?.trim()) {
    where.push('(cc.label LIKE @q OR rc.label LIKE @q OR i.title LIKE @q)');
    params.q = `%${query.q.trim()}%`;
  }
  return { where, params };
}

function addItemFilters(
  where: string[],
  params: Record<string, InValue>,
  query: ReturnType<typeof CorrespondentItemsQuerySchema.parse>,
): void {
  if (query.dateFrom) {
    where.push('i.date >= @date_from');
    params.date_from = query.dateFrom;
  }
  if (query.dateTo) {
    where.push('i.date <= @date_to');
    params.date_to = query.dateTo;
  }
}

function pairExistsForPerson(personId: string, direction: 'all' | 'from-tr' | 'to-tr'): string {
  const base = `SELECT 1
    FROM correspondence_participants cp
    JOIN correspondence_participants rp
      ON rp.item_id = cp.item_id AND rp.role = 'recipient'
    WHERE cp.item_id = i.id
      AND cp.role = 'creator'
      AND cp.correspondent_id <> rp.correspondent_id`;

  if (personId === TR_NODE_ID) {
    if (direction === 'from-tr') return `${base} AND cp.correspondent_id = @tr`;
    if (direction === 'to-tr') return `${base} AND rp.correspondent_id = @tr`;
    return `${base} AND (cp.correspondent_id = @tr OR rp.correspondent_id = @tr)`;
  }

  if (direction === 'from-tr') {
    return `${base} AND cp.correspondent_id = @tr AND rp.correspondent_id = @person_id`;
  }
  if (direction === 'to-tr') {
    return `${base} AND cp.correspondent_id = @person_id AND rp.correspondent_id = @tr`;
  }
  return `${base} AND (
    (cp.correspondent_id = @tr AND rp.correspondent_id = @person_id) OR
    (cp.correspondent_id = @person_id AND rp.correspondent_id = @tr)
  )`;
}

async function handleGraph(db: LibsqlClient, req: Request, res: Response) {
  const parsed = CorrespondentGraphQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid correspondent graph query', details: parsed.error.flatten() });
    return;
  }
  const query = parsed.data;
  const { where, params: baseParams } = graphWhere(query);
  const edgeArgs: Record<string, InValue> = {
    ...baseParams,
    min_letters: query.minLetters,
    limit: query.limit,
  };

  const cte = pairRowsCte(where.join(' AND '));
  const edgeResult = await db.execute({
    sql: `${cte}
      SELECT
        source,
        target,
        MIN(source_label) AS source_label,
        MIN(target_label) AS target_label,
        COUNT(DISTINCT item_id) AS total_count,
        COUNT(DISTINCT CASE WHEN from_tr = 1 THEN item_id END) AS from_tr_count,
        COUNT(DISTINCT CASE WHEN to_tr = 1 THEN item_id END) AS to_tr_count,
        MIN(date) AS first_date,
        MAX(date) AS last_date
      FROM edge_rows
      WHERE source <> target
      GROUP BY source, target
      HAVING total_count >= @min_letters
      ORDER BY total_count DESC, target_label ASC
      LIMIT @limit`,
    args: edgeArgs,
  });

  const totalResult = await db.execute({
    sql: `${cte}
      SELECT
        COUNT(DISTINCT item_id) AS total_items,
        COUNT(DISTINCT CASE WHEN target = @tr THEN source ELSE target END) AS total_correspondents
      FROM edge_rows
      WHERE source <> target`,
    args: baseParams,
  });

  const rows = edgeResult.rows.map(edgeRow);
  const nodes = new Map<string, NodeAccumulator>();
  const edges: CorrespondentEdge[] = rows.map((row) => {
    const tr = addNode(nodes, TR_NODE_ID, TR_NODE_LABEL, true);
    const other = addNode(nodes, row.target, row.targetLabel, false);

    tr.totalCount += row.totalCount;
    tr.outboundCount += row.fromTrCount;
    tr.inboundCount += row.toTrCount;
    tr.firstDate = mergeFirst(tr.firstDate, row.firstDate);
    tr.lastDate = mergeLast(tr.lastDate, row.lastDate);

    other.totalCount += row.totalCount;
    other.inboundCount += row.fromTrCount;
    other.outboundCount += row.toTrCount;
    other.firstDate = mergeFirst(other.firstDate, row.firstDate);
    other.lastDate = mergeLast(other.lastDate, row.lastDate);

    return {
      source: row.source,
      target: row.target,
      totalCount: row.totalCount,
      fromTrCount: row.fromTrCount,
      toTrCount: row.toTrCount,
      firstDate: row.firstDate,
      lastDate: row.lastDate,
    };
  });

  const totalRow = totalResult.rows[0];
  const payload: CorrespondentGraphResponse = {
    nodes: Array.from(nodes.values()).map(nodeFromAccumulator),
    edges,
    totalItems: asNumber(totalRow?.total_items),
    totalCorrespondents: asNumber(totalRow?.total_correspondents) + (edges.length > 0 ? 1 : 0),
    generatedAt: new Date().toISOString(),
  };
  res.json(payload);
}

interface ItemRow {
  id: string;
  documentId: string | null;
  title: string;
  date: string | null;
  dateDisplay: string | null;
  resourceType: 'letter' | 'telegram';
  sourceUrl: string;
  collection: string | null;
}

function itemRow(row: Row): ItemRow {
  return {
    id: asString(row.id),
    documentId: asNullableString(row.document_id),
    title: asString(row.title),
    date: asNullableString(row.date),
    dateDisplay: asNullableString(row.date_display),
    resourceType: asString(row.resource_type) as 'letter' | 'telegram',
    sourceUrl: asString(row.source_url),
    collection: asNullableString(row.collection),
  };
}

async function handleItems(db: LibsqlClient, req: Request, res: Response) {
  const parsed = CorrespondentItemsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid correspondent items query', details: parsed.error.flatten() });
    return;
  }
  const personId = req.params.personId;
  if (!personId) {
    res.status(400).json({ error: 'Missing correspondent id' });
    return;
  }

  const query = parsed.data;
  const baseParams: Record<string, InValue> = {
    tr: TR_NODE_ID,
    person_id: personId,
  };
  const where = [`EXISTS (${pairExistsForPerson(personId, query.direction)})`];
  addItemFilters(where, baseParams, query);

  const countResult = await db.execute({
    sql: `SELECT COUNT(*) AS total
          FROM correspondence_items i
          WHERE ${where.join(' AND ')}`,
    args: baseParams,
  });
  const itemsArgs: Record<string, InValue> = {
    ...baseParams,
    limit: query.limit,
    offset: query.offset,
  };
  const itemsResult = await db.execute({
    sql: `SELECT i.id, d.id AS document_id, i.title, i.date, i.date_display, i.resource_type, i.source_url, i.collection
          FROM correspondence_items i
          LEFT JOIN documents d ON d.source_url = i.source_url
          WHERE ${where.join(' AND ')}
          ORDER BY i.date IS NULL ASC, i.date DESC, i.title ASC
          LIMIT @limit OFFSET @offset`,
    args: itemsArgs,
  });

  const itemRows = itemsResult.rows.map(itemRow);
  const ids = itemRows.map((row) => row.id);
  const participants = new Map<
    string,
    {
      creators: CorrespondentItem['creators'];
      recipients: CorrespondentItem['recipients'];
    }
  >();
  for (const id of ids) participants.set(id, { creators: [], recipients: [] });

  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const participantResult = await db.execute({
      sql: `SELECT
              p.item_id,
              p.role,
              p.raw_name,
              c.id AS correspondent_id,
              c.label
            FROM correspondence_participants p
            JOIN correspondents c ON c.id = p.correspondent_id
            WHERE p.item_id IN (${placeholders})
            ORDER BY p.item_id, p.role, p.ordinal`,
      args: ids,
    });
    for (const row of participantResult.rows) {
      const bucket = participants.get(asString(row.item_id));
      if (!bucket) continue;
      const role = asString(row.role) as 'creator' | 'recipient';
      const entry = {
        id: asString(row.correspondent_id),
        label: asString(row.label),
        rawName: asString(row.raw_name),
        role,
      };
      if (role === 'creator') bucket.creators.push(entry);
      else bucket.recipients.push(entry);
    }
  }

  const payload: CorrespondentItemsResponse = {
    items: itemRows.map((row) => {
      const people = participants.get(row.id) ?? { creators: [], recipients: [] };
      return {
        id: row.id,
        documentId: row.documentId,
        title: row.title,
        date: row.date,
        dateDisplay: row.dateDisplay,
        resourceType: row.resourceType,
        sourceUrl: row.sourceUrl,
        collection: row.collection,
        creators: people.creators,
        recipients: people.recipients,
      };
    }),
    total: asNumber(countResult.rows[0]?.total),
    limit: query.limit,
    offset: query.offset,
  };
  res.json(payload);
}

export function createCorrespondentsRouter(db: LibsqlClient): Router {
  const router = Router();

  router.get('/graph', async (req, res, next) => {
    try {
      await handleGraph(db, req, res);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:personId/items', async (req, res, next) => {
    try {
      await handleItems(db, req, res);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
