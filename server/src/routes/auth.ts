import { GoogleSignInRequestSchema } from '@tr/shared';
import { Router } from 'express';


import type { LibsqlClient } from '../annotations-db.js';
import type { GoogleVerifier } from '../auth/google.js';
import {
  SESSION_COOKIE_NAME,
  createSession,
  destroySession,
  sessionCookieAttributes,
  signSessionId,
} from '../auth/session.js';
import { rowToAuthUser, upsertUserFromGoogle } from '../auth/users.js';

export interface CreateAuthRouterOptions {
  annotationsDb: LibsqlClient;
  verifyGoogleIdToken?: GoogleVerifier;
  sessionSecret: string;
}

export function createAuthRouter(opts: CreateAuthRouterOptions): Router {
  const router = Router();
  const { annotationsDb, verifyGoogleIdToken, sessionSecret } = opts;

  router.post('/google', async (req, res) => {
    if (!verifyGoogleIdToken) {
      return res.status(503).json({
        error: 'Google sign-in is not configured',
        details: 'Set GOOGLE_CLIENT_ID on the server to enable /api/auth/google.',
      });
    }
    const parsed = GoogleSignInRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    let profile;
    try {
      profile = await verifyGoogleIdToken(parsed.data.idToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Token verification failed';
      return res.status(401).json({ error: 'Invalid Google ID token', details: message });
    }

    const userRow = await upsertUserFromGoogle(annotationsDb, profile);
    const session = await createSession(annotationsDb, userRow.id);
    const signed = signSessionId(session.id, sessionSecret);

    res.cookie(SESSION_COOKIE_NAME, signed, sessionCookieAttributes());
    return res.json({ user: rowToAuthUser(userRow) });
  });

  router.get('/me', (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not signed in' });
    }
    return res.json({ user: req.user });
  });

  router.post('/logout', async (req, res) => {
    if (req.sessionId) {
      await destroySession(annotationsDb, req.sessionId);
    }
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return res.json({ ok: true });
  });

  return router;
}
