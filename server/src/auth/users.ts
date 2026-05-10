import { randomUUID } from 'node:crypto';

import type { AuthUser } from '@tr/shared';

import type { LibsqlClient } from '../annotations-db.js';
import type { GoogleProfile } from './google.js';

export interface UserRow {
  id: string;
  google_sub: string;
  email: string;
  name: string;
  picture_url: string | null;
  created_at: string;
}

export function rowToAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    pictureUrl: row.picture_url,
  };
}

export async function upsertUserFromGoogle(
  db: LibsqlClient,
  profile: GoogleProfile,
): Promise<UserRow> {
  const existing = await db.execute({
    sql: `SELECT id, google_sub, email, name, picture_url, created_at
          FROM users WHERE google_sub = ?`,
    args: [profile.sub],
  });
  if (existing.rows[0]) {
    const row = existing.rows[0];
    await db.execute({
      sql: `UPDATE users SET email = ?, name = ?, picture_url = ? WHERE google_sub = ?`,
      args: [profile.email, profile.name, profile.picture, profile.sub],
    });
    return {
      id: String(row.id),
      google_sub: String(row.google_sub),
      email: profile.email,
      name: profile.name,
      picture_url: profile.picture,
      created_at: String(row.created_at),
    };
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO users (id, google_sub, email, name, picture_url, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, profile.sub, profile.email, profile.name, profile.picture, createdAt],
  });
  return {
    id,
    google_sub: profile.sub,
    email: profile.email,
    name: profile.name,
    picture_url: profile.picture,
    created_at: createdAt,
  };
}

export async function findUserById(
  db: LibsqlClient,
  id: string,
): Promise<UserRow | null> {
  const result = await db.execute({
    sql: `SELECT id, google_sub, email, name, picture_url, created_at
          FROM users WHERE id = ?`,
    args: [id],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    google_sub: String(row.google_sub),
    email: String(row.email),
    name: String(row.name),
    picture_url: row.picture_url == null ? null : String(row.picture_url),
    created_at: String(row.created_at),
  };
}
