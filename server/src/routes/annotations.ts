import { randomUUID } from 'node:crypto';

import { Router } from 'express';

import {
  ANNOTATION_JSONLD_CONTEXT,
  AnnotationCreateInputSchema,
  AnnotationPatchSchema,
  type Annotation,
  type AnnotationCollection,
  type AnnotationCreator,
  type AnnotationSelector,
  type AnnotationTextualBody,
} from '@tr/shared';

import type { LibsqlClient as AnnotationsClient } from '../annotations-db.js';
import type { LibsqlClient } from '../db.js';
import { findUserById, rowToAuthUser } from '../auth/users.js';
import { requireUser } from '../middleware/requireUser.js';

interface AnnotationRow {
  id: string;
  document_id: string;
  section_id: string | null;
  creator_id: string;
  motivation: string;
  body_text: string | null;
  selector_json: string;
  created_at: string;
  modified_at: string;
}

function rowToAnnotation(
  row: AnnotationRow,
  creator: AnnotationCreator,
): Annotation {
  const selector = JSON.parse(row.selector_json) as AnnotationSelector | AnnotationSelector[];
  const motivation = row.motivation === 'commenting' ? 'commenting' : 'highlighting';
  const body: AnnotationTextualBody[] | undefined = row.body_text
    ? [
        {
          type: 'TextualBody',
          value: row.body_text,
          format: 'text/plain',
          purpose: 'commenting',
        },
      ]
    : undefined;

  const annotation: Annotation = {
    id: row.id,
    type: 'Annotation',
    motivation,
    target: {
      source: `urn:tr-digital-library:document:${row.document_id}`,
      selector,
    },
    creator,
    created: row.created_at,
    modified: row.modified_at,
    documentId: row.document_id,
    sectionId: row.section_id,
  };
  if (body) annotation.body = body;
  return annotation;
}

function annotationToJsonLd(annotation: Annotation): Record<string, unknown> {
  const { documentId: _doc, sectionId: _sec, ...rest } = annotation;
  return { '@context': ANNOTATION_JSONLD_CONTEXT, ...rest };
}

function shouldRespondJsonLd(req: { headers: Record<string, unknown> }): boolean {
  const accept = String(req.headers.accept ?? '').toLowerCase();
  if (!accept) return false;
  if (accept.includes('application/ld+json')) {
    if (accept.includes('application/json')) {
      return accept.indexOf('application/ld+json') <= accept.indexOf('application/json');
    }
    return true;
  }
  return false;
}

async function fetchCreator(
  annotationsDb: AnnotationsClient,
  creatorId: string,
): Promise<AnnotationCreator> {
  const row = await findUserById(annotationsDb, creatorId);
  if (!row) {
    return { id: creatorId, type: 'Person', name: '(deleted user)' };
  }
  const user = rowToAuthUser(row);
  return { id: user.id, type: 'Person', name: user.name };
}

export interface CreateAnnotationsRouterOptions {
  documentsDb: LibsqlClient;
  annotationsDb: AnnotationsClient;
}

export function createAnnotationsRouter(opts: CreateAnnotationsRouterOptions): Router {
  const router = Router();
  const { documentsDb, annotationsDb } = opts;

  const documentExists = async (id: string): Promise<boolean> => {
    const result = await documentsDb.execute({
      sql: 'SELECT 1 AS x FROM documents WHERE id = ?',
      args: [id],
    });
    return result.rows.length > 0;
  };

  const fetchAnnotationRow = async (id: string): Promise<AnnotationRow | null> => {
    const result = await annotationsDb.execute({
      sql: `SELECT id, document_id, section_id, creator_id, motivation, body_text,
                   selector_json, created_at, modified_at
            FROM annotations WHERE id = ?`,
      args: [id],
    });
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      document_id: String(row.document_id),
      section_id: row.section_id == null ? null : String(row.section_id),
      creator_id: String(row.creator_id),
      motivation: String(row.motivation),
      body_text: row.body_text == null ? null : String(row.body_text),
      selector_json: String(row.selector_json),
      created_at: String(row.created_at),
      modified_at: String(row.modified_at),
    };
  };

  router.post('/', requireUser, async (req, res) => {
    const parsed = AnnotationCreateInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const input = parsed.data;
    if (!(await documentExists(input.documentId))) {
      return res.status(404).json({ error: 'Document not found' });
    }
    if (input.motivation === 'commenting' && !input.bodyText) {
      return res
        .status(400)
        .json({ error: 'commenting motivation requires bodyText' });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const selectorJson = JSON.stringify(input.target.selector);

    await annotationsDb.execute({
      sql: `INSERT INTO annotations (
              id, document_id, section_id, creator_id, motivation,
              body_text, selector_json, created_at, modified_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.documentId,
        input.sectionId ?? null,
        req.user!.id,
        input.motivation,
        input.motivation === 'highlighting' ? null : (input.bodyText ?? null),
        selectorJson,
        now,
        now,
      ],
    });

    const row = await fetchAnnotationRow(id);
    if (!row) return res.status(500).json({ error: 'Failed to load created annotation' });
    const creator: AnnotationCreator = {
      id: req.user!.id,
      type: 'Person',
      name: req.user!.name,
    };
    return res.status(201).json(rowToAnnotation(row, creator));
  });

  router.get('/:id', async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing annotation id' });
    const row = await fetchAnnotationRow(id);
    if (!row) return res.status(404).json({ error: 'Annotation not found' });
    const creator = await fetchCreator(annotationsDb, row.creator_id);
    const annotation = rowToAnnotation(row, creator);
    if (shouldRespondJsonLd(req)) {
      res.setHeader('Content-Type', 'application/ld+json; charset=utf-8');
      return res.send(JSON.stringify(annotationToJsonLd(annotation)));
    }
    return res.json(annotation);
  });

  router.patch('/:id', requireUser, async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing annotation id' });
    const parsed = AnnotationPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const existing = await fetchAnnotationRow(id);
    if (!existing) return res.status(404).json({ error: 'Annotation not found' });
    if (existing.creator_id !== req.user!.id) {
      return res.status(403).json({ error: 'Only the author can edit this annotation' });
    }

    const nextMotivation = parsed.data.motivation ?? existing.motivation;
    const nextBody: string | null =
      parsed.data.bodyText !== undefined
        ? parsed.data.bodyText
        : existing.body_text;
    if (nextMotivation === 'commenting' && !nextBody) {
      return res
        .status(400)
        .json({ error: 'commenting motivation requires bodyText' });
    }

    const now = new Date().toISOString();
    await annotationsDb.execute({
      sql: `UPDATE annotations
            SET motivation = ?, body_text = ?, modified_at = ?
            WHERE id = ?`,
      args: [
        nextMotivation,
        nextMotivation === 'highlighting' ? null : nextBody,
        now,
        id,
      ],
    });

    const updated = await fetchAnnotationRow(id);
    if (!updated) return res.status(500).json({ error: 'Annotation disappeared' });
    const creator: AnnotationCreator = {
      id: req.user!.id,
      type: 'Person',
      name: req.user!.name,
    };
    return res.json(rowToAnnotation(updated, creator));
  });

  router.delete('/:id', requireUser, async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing annotation id' });
    const existing = await fetchAnnotationRow(id);
    if (!existing) return res.status(404).json({ error: 'Annotation not found' });
    if (existing.creator_id !== req.user!.id) {
      return res.status(403).json({ error: 'Only the author can delete this annotation' });
    }
    await annotationsDb.execute({
      sql: 'DELETE FROM annotations WHERE id = ?',
      args: [id],
    });
    return res.status(204).send();
  });

  return router;
}

export interface CreateDocumentAnnotationsRouterOptions {
  documentsDb: LibsqlClient;
  annotationsDb: AnnotationsClient;
}

export function createDocumentAnnotationsRouter(
  opts: CreateDocumentAnnotationsRouterOptions,
): Router {
  const router = Router({ mergeParams: true });
  const { documentsDb, annotationsDb } = opts;

  router.get('/', async (req, res) => {
    const documentId = (req.params as { id?: string }).id;
    if (!documentId) return res.status(400).json({ error: 'Missing document id' });
    const docResult = await documentsDb.execute({
      sql: 'SELECT 1 AS x FROM documents WHERE id = ?',
      args: [documentId],
    });
    if (docResult.rows.length === 0) return res.status(404).json({ error: 'Document not found' });

    const result = await annotationsDb.execute({
      sql: `SELECT id, document_id, section_id, creator_id, motivation, body_text,
                   selector_json, created_at, modified_at
            FROM annotations
            WHERE document_id = ?
            ORDER BY created_at ASC`,
      args: [documentId],
    });

    const items: Annotation[] = [];
    const creatorCache = new Map<string, AnnotationCreator>();
    for (const raw of result.rows) {
      const row: AnnotationRow = {
        id: String(raw.id),
        document_id: String(raw.document_id),
        section_id: raw.section_id == null ? null : String(raw.section_id),
        creator_id: String(raw.creator_id),
        motivation: String(raw.motivation),
        body_text: raw.body_text == null ? null : String(raw.body_text),
        selector_json: String(raw.selector_json),
        created_at: String(raw.created_at),
        modified_at: String(raw.modified_at),
      };
      let creator = creatorCache.get(row.creator_id);
      if (!creator) {
        creator = await fetchCreator(annotationsDb, row.creator_id);
        creatorCache.set(row.creator_id, creator);
      }
      items.push(rowToAnnotation(row, creator));
    }

    const collection: AnnotationCollection = {
      type: ['BasicContainer', 'AnnotationCollection'],
      total: items.length,
      items,
    };
    return res.json(collection);
  });

  return router;
}
