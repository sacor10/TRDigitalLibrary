import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database as DatabaseT } from 'better-sqlite3';

import {
  ANNOTATION_JSONLD_CONTEXT,
  AnnotationCollectionSchema,
  AnnotationSchema,
  type Annotation,
  type AnnotationCreateInput,
} from '@tr/shared';

import { openAnnotationsDb, type LibsqlClient } from '../annotations-db.js';
import { createApp } from '../app.js';
import type { GoogleVerifier } from '../auth/google.js';
import { openInMemoryDatabase, upsertDocument } from '../db.js';
import { cloneTestDocuments } from './fixtures/documents.js';

const baseInput: AnnotationCreateInput = {
  documentId: 'man-in-the-arena',
  sectionId: null,
  motivation: 'commenting',
  bodyText: 'A foundational metaphor for civic engagement.',
  target: {
    source: 'urn:tr-digital-library:document:man-in-the-arena',
    selector: [
      {
        type: 'TextQuoteSelector',
        exact: 'man who is actually in the arena',
        prefix: 'It is not the critic who counts; ... the credit belongs to the ',
        suffix: ', whose face is marred by dust and sweat and blood',
      },
      { type: 'TextPositionSelector', start: 142, end: 175 },
    ],
  },
};

describe('Annotations API', () => {
  let db: DatabaseT;
  let annotationsDb: LibsqlClient;
  let app: ReturnType<typeof createApp>;

  const verifyGoogleIdToken: GoogleVerifier = async (idToken: string) => {
    const tag = idToken.split(':')[1] ?? 'a';
    return {
      sub: `google-sub-${tag}`,
      email: `${tag}@example.org`,
      name: `User ${tag.toUpperCase()}`,
      picture: null,
    };
  };

  beforeAll(async () => {
    db = openInMemoryDatabase();
    for (const doc of cloneTestDocuments()) {
      upsertDocument(db, { ...doc, transcription: `Stub for ${doc.title}` });
    }
    annotationsDb = await openAnnotationsDb({ url: ':memory:' });
    app = createApp(db, {
      annotationsDb,
      sessionSecret: 'test-secret',
      verifyGoogleIdToken,
    });
  });

  afterAll(() => {
    db.close();
    annotationsDb.close();
  });

  async function signedInAgent(tag = 'a'): Promise<ReturnType<typeof request.agent>> {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/auth/google')
      .send({ idToken: `id:${tag}` });
    expect(res.status).toBe(200);
    return agent;
  }

  it('rejects unauthenticated POST /api/annotations', async () => {
    const res = await request(app).post('/api/annotations').send(baseInput);
    expect(res.status).toBe(401);
  });

  it('creates an annotation and validates against the W3C-shaped schema', async () => {
    const agent = await signedInAgent('a');
    const res = await agent.post('/api/annotations').send(baseInput);
    expect(res.status).toBe(201);
    expect(() => AnnotationSchema.parse(res.body)).not.toThrow();
    expect(res.body.type).toBe('Annotation');
    expect(res.body.motivation).toBe('commenting');
    expect(res.body.body[0].value).toBe(baseInput.bodyText);
    expect(res.body.creator.type).toBe('Person');
  });

  it('returns 404 when the document does not exist', async () => {
    const agent = await signedInAgent('a');
    const res = await agent
      .post('/api/annotations')
      .send({ ...baseInput, documentId: 'no-such-doc' });
    expect(res.status).toBe(404);
  });

  it('rejects commenting motivation without bodyText', async () => {
    const agent = await signedInAgent('a');
    const res = await agent
      .post('/api/annotations')
      .send({
        ...baseInput,
        bodyText: undefined,
      });
    expect(res.status).toBe(400);
  });

  it('returns JSON-LD with @context when Accept: application/ld+json', async () => {
    const agent = await signedInAgent('a');
    const created = await agent.post('/api/annotations').send(baseInput);
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const ld = await request(app)
      .get(`/api/annotations/${id}`)
      .set('Accept', 'application/ld+json');
    expect(ld.status).toBe(200);
    expect(ld.headers['content-type']).toMatch(/application\/ld\+json/);
    const parsed = JSON.parse(ld.text) as Record<string, unknown>;
    expect(parsed['@context']).toBe(ANNOTATION_JSONLD_CONTEXT);
    expect(parsed['type']).toBe('Annotation');
  });

  it('returns plain JSON without @context by default', async () => {
    const agent = await signedInAgent('a');
    const created = await agent.post('/api/annotations').send(baseInput);
    const id = created.body.id as string;
    const res = await request(app).get(`/api/annotations/${id}`);
    expect(res.status).toBe(200);
    expect(res.body['@context']).toBeUndefined();
    expect(res.body.type).toBe('Annotation');
  });

  it('lists annotations as a W3C AnnotationCollection (public, no auth)', async () => {
    const agent = await signedInAgent('a');
    await agent.post('/api/annotations').send(baseInput);

    const res = await request(app).get(
      `/api/documents/${baseInput.documentId}/annotations`,
    );
    expect(res.status).toBe(200);
    expect(() => AnnotationCollectionSchema.parse(res.body)).not.toThrow();
    expect(res.body.type).toEqual(['BasicContainer', 'AnnotationCollection']);
    expect(res.body.total).toBeGreaterThan(0);
  });

  it('only allows the author to PATCH their annotation', async () => {
    const authorAgent = await signedInAgent('a');
    const created = await authorAgent.post('/api/annotations').send(baseInput);
    const id = created.body.id as string;

    const otherAgent = await signedInAgent('b');
    const forbidden = await otherAgent
      .patch(`/api/annotations/${id}`)
      .send({ bodyText: 'sneaky edit' });
    expect(forbidden.status).toBe(403);

    const ok = await authorAgent
      .patch(`/api/annotations/${id}`)
      .send({ bodyText: 'updated note' });
    expect(ok.status).toBe(200);
    expect(ok.body.body[0].value).toBe('updated note');
  });

  it('only allows the author to DELETE their annotation', async () => {
    const authorAgent = await signedInAgent('a');
    const created = await authorAgent.post('/api/annotations').send(baseInput);
    const id = created.body.id as string;

    const otherAgent = await signedInAgent('b');
    const forbidden = await otherAgent.delete(`/api/annotations/${id}`);
    expect(forbidden.status).toBe(403);

    const ok = await authorAgent.delete(`/api/annotations/${id}`);
    expect(ok.status).toBe(204);

    const gone = await request(app).get(`/api/annotations/${id}`);
    expect(gone.status).toBe(404);
  });

  it('preserves the W3C selector array verbatim', async () => {
    const agent = await signedInAgent('a');
    const created = await agent.post('/api/annotations').send(baseInput);
    expect(created.status).toBe(201);
    const annotation = created.body as Annotation;
    expect(annotation.target.selector).toEqual(baseInput.target.selector);
  });
});
