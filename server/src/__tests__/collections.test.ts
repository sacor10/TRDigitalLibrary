import { CollectionDetailSchema, CollectionSchema } from '@tr/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openAnnotationsDb, type LibsqlClient as AnnotationsClient } from '../annotations-db.js';
import { createApp } from '../app.js';
import type { GoogleVerifier } from '../auth/google.js';
import { openInMemoryDatabase, upsertDocument, type LibsqlClient } from '../db.js';

import { cloneTestDocuments } from './fixtures/documents.js';

describe('Collections API', () => {
  let db: LibsqlClient;
  let annotationsDb: AnnotationsClient;
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
    db = await openInMemoryDatabase();
    for (const doc of cloneTestDocuments()) {
      await upsertDocument(db, { ...doc, transcription: `Stub for ${doc.title}` });
    }
    annotationsDb = await openAnnotationsDb({ url: ':memory:' });
    app = createApp(db, { annotationsDb, sessionSecret: 'test-secret', verifyGoogleIdToken });
  });

  afterAll(() => {
    db.close();
    annotationsDb.close();
  });

  async function signedInAgent(tag = 'a'): Promise<ReturnType<typeof request.agent>> {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/google').send({ idToken: `id:${tag}` });
    expect(res.status).toBe(200);
    return agent;
  }

  it('rejects unauthenticated list and create', async () => {
    expect((await request(app).get('/api/collections')).status).toBe(401);
    expect((await request(app).post('/api/collections').send({ title: 'x' })).status).toBe(401);
  });

  it('creates, lists, and adds items to a collection', async () => {
    const agent = await signedInAgent('a');
    const created = await agent
      .post('/api/collections')
      .send({ title: 'Conservation reading', description: 'For class', isPublic: false });
    expect(created.status).toBe(201);
    expect(() => CollectionSchema.parse(created.body)).not.toThrow();
    const id = created.body.id as string;

    const list = await agent.get('/api/collections');
    expect(list.status).toBe(200);
    expect(list.body.items.some((c: { id: string }) => c.id === id)).toBe(true);

    const add = await agent.post(`/api/collections/${id}/items`).send({ documentId: 'man-in-the-arena' });
    expect(add.status).toBe(204);

    const detail = await agent.get(`/api/collections/${id}`);
    expect(detail.status).toBe(200);
    expect(() => CollectionDetailSchema.parse(detail.body)).not.toThrow();
    expect(detail.body.items).toHaveLength(1);
    expect(detail.body.items[0].document.id).toBe('man-in-the-arena');
    expect(detail.body.itemCount).toBe(1);
  });

  it('rejects adding a non-existent document', async () => {
    const agent = await signedInAgent('a');
    const created = await agent.post('/api/collections').send({ title: 'L' });
    const id = created.body.id as string;
    const add = await agent.post(`/api/collections/${id}/items`).send({ documentId: 'nope' });
    expect(add.status).toBe(404);
  });

  it('keeps private collections invisible to other users but exposes public ones', async () => {
    const owner = await signedInAgent('a');
    const priv = await owner.post('/api/collections').send({ title: 'Private', isPublic: false });
    const pub = await owner.post('/api/collections').send({ title: 'Public', isPublic: true });

    const other = await signedInAgent('b');
    expect((await other.get(`/api/collections/${priv.body.id}`)).status).toBe(404);
    const pubView = await other.get(`/api/collections/${pub.body.id}`);
    expect(pubView.status).toBe(200);
    expect(pubView.body.title).toBe('Public');
  });

  it('forbids a non-owner from editing or deleting', async () => {
    const owner = await signedInAgent('a');
    const created = await owner.post('/api/collections').send({ title: 'Mine', isPublic: true });
    const id = created.body.id as string;

    const other = await signedInAgent('b');
    expect((await other.patch(`/api/collections/${id}`).send({ title: 'Hijack' })).status).toBe(403);
    expect((await other.delete(`/api/collections/${id}`)).status).toBe(403);
  });

  it('removes an item and deletes a collection', async () => {
    const agent = await signedInAgent('a');
    const created = await agent.post('/api/collections').send({ title: 'Temp' });
    const id = created.body.id as string;
    await agent.post(`/api/collections/${id}/items`).send({ documentId: 'strenuous-life' });

    const removed = await agent.delete(`/api/collections/${id}/items/strenuous-life`);
    expect(removed.status).toBe(204);
    const detail = await agent.get(`/api/collections/${id}`);
    expect(detail.body.items).toHaveLength(0);

    expect((await agent.delete(`/api/collections/${id}`)).status).toBe(204);
    expect((await agent.get(`/api/collections/${id}`)).status).toBe(404);
  });
});
