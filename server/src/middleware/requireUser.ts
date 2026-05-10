import type { NextFunction, Request, Response } from 'express';

import type { LibsqlClient } from '../annotations-db.js';
import {
  SESSION_COOKIE_NAME,
  readSession,
  verifySignedSessionId,
} from '../auth/session.js';
import { findUserById, rowToAuthUser } from '../auth/users.js';
import type { AuthUser } from '@tr/shared';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
    }
  }
}

export interface AuthDeps {
  annotationsDb: LibsqlClient;
  sessionSecret: string;
}

export function loadUser(deps: AuthDeps) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
      const signed = cookies[SESSION_COOKIE_NAME];
      if (!signed) return next();
      const sessionId = verifySignedSessionId(signed, deps.sessionSecret);
      if (!sessionId) return next();
      const session = await readSession(deps.annotationsDb, sessionId);
      if (!session) return next();
      const userRow = await findUserById(deps.annotationsDb, session.userId);
      if (!userRow) return next();
      req.user = rowToAuthUser(userRow);
      req.sessionId = sessionId;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}
