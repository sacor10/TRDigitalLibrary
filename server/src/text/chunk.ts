/**
 * Shared text chunker. Splits long text into fixed-size, whitespace-collapsed
 * windows. Used by the embeddings pipeline (per-chunk vectors, averaged) and by
 * the chunk-snippet index (so FTS5 snippet() runs over ~2 KB windows instead of
 * the multi-MB `transcription` column). One chunker keeps both paths aligned.
 */

// ~2000 chars keeps each chunk comfortably under the embedding model's token
// limit and small enough that snippet() over a single chunk is sub-millisecond.
export const CHUNK_CHARS = 2000;

export function chunkText(text: string, chunkChars: number = CHUNK_CHARS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += chunkChars) {
    chunks.push(clean.slice(i, i + chunkChars));
  }
  return chunks;
}
