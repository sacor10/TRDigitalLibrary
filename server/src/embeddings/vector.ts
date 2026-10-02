/**
 * Pure vector helpers for semantic / hybrid search. No model dependency, so
 * these are fully unit-testable on their own. Embeddings are stored as
 * little-endian Float32 BLOBs in document_embeddings.embedding.
 */

/** Encode a Float32 vector as a little-endian byte buffer for BLOB storage. */
export function encodeEmbedding(vec: Float32Array | number[]): Buffer {
  const arr = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

/** Decode a little-endian Float32 BLOB back into a Float32Array. */
export function decodeEmbedding(blob: Uint8Array | ArrayBuffer): Float32Array {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  // Copy into a fresh, aligned buffer (the source view may be unaligned).
  const aligned = new Uint8Array(bytes.byteLength);
  aligned.set(bytes);
  return new Float32Array(aligned.buffer);
}

/** Cosine similarity in [-1, 1]. Safe against zero-length vectors. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Min-max normalize a set of scores into [0, 1]; constant input maps to 1. */
export function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range === 0) return values.map(() => 1);
  return values.map((v) => (v - min) / range);
}

export interface HybridInput {
  /** Higher is better. BM25 from FTS5 is negative (better = more negative). */
  lexicalScore: number;
  /** Cosine similarity in [-1, 1]; undefined when no embedding exists. */
  cosine: number | undefined;
}

/**
 * Blend lexical (BM25) and semantic (cosine) signals into a single ranking
 * score. `alpha` weights the lexical component; (1 - alpha) the semantic one.
 * BM25 is more-negative-is-better, so we negate before normalizing so that
 * "higher is better" holds across both signals.
 */
export function hybridScores(inputs: HybridInput[], alpha: number): number[] {
  const lexNormalized = minMaxNormalize(inputs.map((i) => -i.lexicalScore));
  // Map cosine [-1,1] -> [0,1]; treat a missing embedding as neutral (0.5).
  const semNormalized = inputs.map((i) =>
    i.cosine === undefined ? 0.5 : (i.cosine + 1) / 2,
  );
  return inputs.map((_, idx) => alpha * lexNormalized[idx]! + (1 - alpha) * semNormalized[idx]!);
}
