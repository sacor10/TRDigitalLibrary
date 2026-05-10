import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type { LibsqlClient } from '../annotations-db.js';

export const SESSION_COOKIE_NAME = 'tr_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: string;
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function signSessionId(sessionId: string, secret: string): string {
  return `${sessionId}.${sign(sessionId, secret)}`;
}

export function verifySignedSessionId(signed: string, secret: string): string | null {
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const sessionId = signed.slice(0, dot);
  const provided = signed.slice(dot + 1);
  const expected = sign(sessionId, secret);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return sessionId;
}

export async function createSession(
  db: LibsqlClient,
  userId: string,
): Promise<SessionRecord> {
  const id = randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);
  await db.execute({
    sql: `INSERT INTO sessions (id, user_id, expires_at, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [id, userId, expiresAt.toISOString(), createdAt.toISOString()],
  });
  return { id, userId, expiresAt: expiresAt.toISOString() };
}

export async function readSession(
  db: LibsqlClient,
  sessionId: string,
): Promise<SessionRecord | null> {
  const result = await db.execute({
    sql: `SELECT id, user_id, expires_at FROM sessions WHERE id = ?`,
    args: [sessionId],
  });
  const row = result.rows[0];
  if (!row) return null;
  const expiresAt = String(row.expires_at);
  if (new Date(expiresAt).getTime() < Date.now()) {
    await destroySession(db, sessionId);
    return null;
  }
  return { id: String(row.id), userId: String(row.user_id), expiresAt };
}

export async function destroySession(db: LibsqlClient, sessionId: string): Promise<void> {
  await db.execute({ sql: 'DELETE FROM sessions WHERE id = ?', args: [sessionId] });
}

export interface CookieAttributes {
  httpOnly: true;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
  secure: boolean;
}

export function sessionCookieAttributes(): CookieAttributes {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
    secure: process.env.NODE_ENV === 'production',
  };
}
