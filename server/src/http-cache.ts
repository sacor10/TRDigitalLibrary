import type { Response } from 'express';

export function setPublicCache(res: Response, seconds = 300): void {
  res.setHeader('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=${seconds * 2}`);
}

