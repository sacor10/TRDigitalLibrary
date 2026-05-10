import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database as DatabaseT } from 'better-sqlite3';

import { openAnnotationsDb, type LibsqlClient } from '../annotations-db.js';
import { createApp } from '../app.js';
import type { GoogleVerifier } from '../auth/google.js';
import { openInMemoryDatabase } from '../db.js';

const TEST_SESSION_SECRET = 'test-secret-deterministic';

describe('Auth API', () => {
  let db: DatabaseT;
  let annotationsDb: LibsqlClient;
  let app: ReturnType<typeof createApp>;

  const stubProfile = {
    sub: 'google-sub-12345',
    email: 'jane.scholar@example.org',
    name: 'Jane Scholar',
    picture: 'https://example.org/jane.jpg',
  };
  const verifyGoogleIdToken: GoogleVerifier = async (idToken: string) => {
    if (idToken === 'invalid') throw new Error('bad token');
    return stubProfile;
  };

  beforeAll(async () => {
    db = openInMemoryDatabase();
    annotationsDb = await openAnnotationsDb({ url: ':memory:' });
    app = createApp(db, {
      annotationsDb,
      sessionSecret: TEST_SESSION_SECRET,
      verifyGoogleIdToken,
    });
  });

  afterAll(() => {
    db.close();
    annotationsDb.close();
  });

  it('rejects /api/auth/me when no cookie is sent', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('signs in with a Google ID token and returns the user', async () => {
    const res = await request(app)
      .post('/api/auth/google')
      .send({ idToken: 'fake-but-stubbed' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(stubProfile.email);
    expect(res.body.user.name).toBe(stubProfile.name);
    const setCookie = res.headers['set-cookie'];
    expect(Array.isArray(setCookie) ? setCookie.join(' ') : String(setCookie)).toMatch(
      /tr_session=/,
    );
  });

  it('rejects an invalid Google ID token', async () => {
    const res = await request(app)
      .post('/api/auth/google')
      .send({ idToken: 'invalid' });
    expect(res.status).toBe(401);
  });

  it('issues a session cookie that authenticates /api/auth/me', async () => {
    const agent = request.agent(app);
    const signIn = await agent
      .post('/api/auth/google')
      .send({ idToken: 'fake-but-stubbed' });
    expect(signIn.status).toBe(200);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(stubProfile.email);
  });

  it('logs out and invalidates the session', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/google').send({ idToken: 'fake-but-stubbed' });

    const logout = await agent.post('/api/auth/logout');
    expect(logout.status).toBe(200);

    // After logout the supertest agent retains the cookie clearing; /me should 401
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  it('rejects a tampered cookie', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'tr_session=not-a-valid-signed-id');
    expect(res.status).toBe(401);
  });
});
