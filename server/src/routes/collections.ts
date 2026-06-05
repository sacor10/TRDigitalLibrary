import { randomUUID } from 'node:crypto';

import {
  CollectionCreateInputSchema,
  CollectionItemInputSchema,
  CollectionPatchSchema,
  type Collection,
  type CollectionDetail,
  type CollectionItem,
} from '@tr/shared';
import { Router } from 'express';

import type { LibsqlClient as AnnotationsClient } from '../annotations-db.js';
import { findUserById, rowToAuthUser } from '../auth/users.js';
import { rowToDocument, rowToDocumentRow, type LibsqlClient } from '../db.js';
import { requireUser } from '../middleware/requireUser.js';

import { DOCUMENT_SUMMARY_COLUMNS } from './document-query.js';

interface CollectionRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  is_public: number;
  created_at: string;
  modified_at: string;
  item_count?: number;
}

export interface CreateCollectionsRouterOptions {
  documentsDb: LibsqlClient;
  annotationsDb: AnnotationsClient;
}

export function createCollectionsRouter(opts: CreateCollectionsRouterOptions): Router {
  const router = Router();
  const { documentsDb, annotationsDb } = opts;

  const documentExists = async (id: string): Promise<boolean> => {
    const result = await documentsDb.execute({
      sql: 'SELECT 1 AS x FROM documents WHERE id = ?',
      args: [id],
    });
    return result.rows.length > 0;
  };

  const fetchCollectionRow = async (id: string): Promise<CollectionRow | null> => {
    const result = await annotationsDb.execute({
      sql: `SELECT c.id, c.user_id, c.title, c.description, c.is_public,
                   c.created_at, c.modified_at,
                   (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count
            FROM collections c WHERE c.id = ?`,
      args: [id],
    });
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      title: String(row.title),
      description: row.description == null ? null : String(row.description),
      is_public: Number(row.is_public),
      created_at: String(row.created_at),
      modified_at: String(row.modified_at),
      item_count: Number(row.item_count ?? 0),
    };
  };

  const ownerName = async (userId: string, fallback?: string): Promise<string> => {
    if (fallback) return fallback;
    const row = await findUserById(annotationsDb, userId);
    return row ? rowToAuthUser(row).name : '(deleted user)';
  };

  const toCollection = (row: CollectionRow, owner: string): Collection => ({
    id: row.id,
    title: row.title,
    description: row.description,
    isPublic: row.is_public === 1,
    ownerName: owner,
    itemCount: row.item_count ?? 0,
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
  });

  // List the signed-in user's own collections.
  router.get('/', requireUser, async (req, res) => {
    const result = await annotationsDb.execute({
      sql: `SELECT c.id, c.user_id, c.title, c.description, c.is_public,
                   c.created_at, c.modified_at,
                   (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count
            FROM collections c
            WHERE c.user_id = ?
            ORDER BY c.modified_at DESC`,
      args: [req.user!.id],
    });
    const items: Collection[] = result.rows.map((raw) =>
      toCollection(
        {
          id: String(raw.id),
          user_id: String(raw.user_id),
          title: String(raw.title),
          description: raw.description == null ? null : String(raw.description),
          is_public: Number(raw.is_public),
          created_at: String(raw.created_at),
          modified_at: String(raw.modified_at),
          item_count: Number(raw.item_count ?? 0),
        },
        req.user!.name,
      ),
    );
    return res.json({ items });
  });

  router.post('/', requireUser, async (req, res) => {
    const parsed = CollectionCreateInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    await annotationsDb.execute({
      sql: `INSERT INTO collections (id, user_id, title, description, is_public, created_at, modified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        req.user!.id,
        parsed.data.title,
        parsed.data.description ?? null,
        parsed.data.isPublic ? 1 : 0,
        now,
        now,
      ],
    });
    const row = await fetchCollectionRow(id);
    if (!row) return res.status(500).json({ error: 'Failed to load created collection' });
    return res.status(201).json(toCollection(row, req.user!.name));
  });

  // Collection detail with hydrated document summaries. Public collections are
  // viewable by anyone; private ones only by the owner.
  router.get('/:id', async (req, res) => {
    const collectionId = (req.params as { id?: string }).id;
    if (!collectionId) return res.status(400).json({ error: 'Missing collection id' });
    const row = await fetchCollectionRow(collectionId);
    if (!row) return res.status(404).json({ error: 'Collection not found' });
    const isOwner = req.user?.id === row.user_id;
    if (row.is_public !== 1 && !isOwner) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const itemRows = await annotationsDb.execute({
      sql: `SELECT document_id, note, added_at FROM collection_items
            WHERE collection_id = ? ORDER BY added_at DESC`,
      args: [row.id],
    });
    const orderedIds = itemRows.rows.map((r) => String(r.document_id));
    const noteByDoc = new Map<string, { note: string | null; addedAt: string }>();
    for (const r of itemRows.rows) {
      noteByDoc.set(String(r.document_id), {
        note: r.note == null ? null : String(r.note),
        addedAt: String(r.added_at),
      });
    }

    const items: CollectionItem[] = [];
    if (orderedIds.length > 0) {
      const placeholders = orderedIds.map(() => '?').join(', ');
      const docResult = await documentsDb.execute({
        sql: `SELECT ${DOCUMENT_SUMMARY_COLUMNS} FROM documents WHERE id IN (${placeholders})`,
        args: orderedIds,
      });
      const docById = new Map(
        docResult.rows.map((r) => {
          const doc = rowToDocument(rowToDocumentRow(r));
          return [doc.id, doc];
        }),
      );
      // Preserve the saved order (most-recently-added first).
      for (const docId of orderedIds) {
        const doc = docById.get(docId);
        const meta = noteByDoc.get(docId);
        if (doc && meta) {
          items.push({ document: doc, note: meta.note, addedAt: meta.addedAt });
        }
      }
    }

    const detail: CollectionDetail = {
      ...toCollection(row, await ownerName(row.user_id, isOwner ? req.user?.name : undefined)),
      items,
    };
    return res.json(detail);
  });

  router.patch('/:id', requireUser, async (req, res) => {
    const collectionId = (req.params as { id?: string }).id;
    if (!collectionId) return res.status(400).json({ error: 'Missing collection id' });
    const parsed = CollectionPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const existing = await fetchCollectionRow(collectionId);
    if (!existing) return res.status(404).json({ error: 'Collection not found' });
    if (existing.user_id !== req.user!.id) {
      return res.status(403).json({ error: 'Only the owner can edit this collection' });
    }
    const title = parsed.data.title ?? existing.title;
    const description =
      parsed.data.description !== undefined ? parsed.data.description : existing.description;
    const isPublic =
      parsed.data.isPublic !== undefined ? (parsed.data.isPublic ? 1 : 0) : existing.is_public;
    const now = new Date().toISOString();
    await annotationsDb.execute({
      sql: `UPDATE collections SET title = ?, description = ?, is_public = ?, modified_at = ?
            WHERE id = ?`,
      args: [title, description, isPublic, now, existing.id],
    });
    const updated = await fetchCollectionRow(existing.id);
    return res.json(toCollection(updated!, req.user!.name));
  });

  router.delete('/:id', requireUser, async (req, res) => {
    const collectionId = (req.params as { id?: string }).id;
    if (!collectionId) return res.status(400).json({ error: 'Missing collection id' });
    const existing = await fetchCollectionRow(collectionId);
    if (!existing) return res.status(404).json({ error: 'Collection not found' });
    if (existing.user_id !== req.user!.id) {
      return res.status(403).json({ error: 'Only the owner can delete this collection' });
    }
    await annotationsDb.execute({ sql: 'DELETE FROM collections WHERE id = ?', args: [existing.id] });
    return res.status(204).send();
  });

  router.post('/:id/items', requireUser, async (req, res) => {
    const collectionId = (req.params as { id?: string }).id;
    if (!collectionId) return res.status(400).json({ error: 'Missing collection id' });
    const parsed = CollectionItemInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const existing = await fetchCollectionRow(collectionId);
    if (!existing) return res.status(404).json({ error: 'Collection not found' });
    if (existing.user_id !== req.user!.id) {
      return res.status(403).json({ error: 'Only the owner can modify this collection' });
    }
    if (!(await documentExists(parsed.data.documentId))) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const now = new Date().toISOString();
    await annotationsDb.execute({
      sql: `INSERT INTO collection_items (collection_id, document_id, note, added_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(collection_id, document_id)
            DO UPDATE SET note = excluded.note`,
      args: [existing.id, parsed.data.documentId, parsed.data.note ?? null, now],
    });
    await annotationsDb.execute({
      sql: 'UPDATE collections SET modified_at = ? WHERE id = ?',
      args: [now, existing.id],
    });
    return res.status(204).send();
  });

  router.delete('/:id/items/:documentId', requireUser, async (req, res) => {
    const { id, documentId } = req.params as { id?: string; documentId?: string };
    if (!id || !documentId) return res.status(400).json({ error: 'Missing id or documentId' });
    const existing = await fetchCollectionRow(id);
    if (!existing) return res.status(404).json({ error: 'Collection not found' });
    if (existing.user_id !== req.user!.id) {
      return res.status(403).json({ error: 'Only the owner can modify this collection' });
    }
    await annotationsDb.execute({
      sql: 'DELETE FROM collection_items WHERE collection_id = ? AND document_id = ?',
      args: [existing.id, documentId],
    });
    await annotationsDb.execute({
      sql: 'UPDATE collections SET modified_at = ? WHERE id = ?',
      args: [new Date().toISOString(), existing.id],
    });
    return res.status(204).send();
  });

  return router;
}
