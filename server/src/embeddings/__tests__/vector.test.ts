import { describe, expect, it } from 'vitest';

import {
  cosineSimilarity,
  decodeEmbedding,
  encodeEmbedding,
  hybridScores,
  minMaxNormalize,
} from '../vector.js';

describe('embedding vector helpers', () => {
  it('round-trips a Float32 vector through BLOB encode/decode', () => {
    const vec = Float32Array.from([0.1, -0.2, 0.3, 0.4]);
    const decoded = decodeEmbedding(encodeEmbedding(vec));
    expect(Array.from(decoded)).toEqual(Array.from(vec));
  });

  it('computes cosine similarity', () => {
    const a = Float32Array.from([1, 0, 0]);
    const b = Float32Array.from([1, 0, 0]);
    const c = Float32Array.from([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
    expect(cosineSimilarity(a, c)).toBeCloseTo(0, 6);
    expect(cosineSimilarity(a, Float32Array.from([-1, 0, 0]))).toBeCloseTo(-1, 6);
  });

  it('returns 0 cosine for a zero vector', () => {
    expect(cosineSimilarity(Float32Array.from([0, 0]), Float32Array.from([1, 1]))).toBe(0);
  });

  it('min-max normalizes into [0,1], constant input maps to 1', () => {
    expect(minMaxNormalize([2, 4, 6])).toEqual([0, 0.5, 1]);
    expect(minMaxNormalize([5, 5, 5])).toEqual([1, 1, 1]);
  });

  it('blends lexical and semantic signals; alpha weights lexical', () => {
    // doc A: best lexical (most negative BM25), weak cosine.
    // doc B: weak lexical, strong cosine.
    const inputs = [
      { lexicalScore: -5, cosine: -1 },
      { lexicalScore: -1, cosine: 1 },
    ];
    const lexicalHeavy = hybridScores(inputs, 1);
    expect(lexicalHeavy[0]).toBeGreaterThan(lexicalHeavy[1]!);
    const semanticHeavy = hybridScores(inputs, 0);
    expect(semanticHeavy[1]).toBeGreaterThan(semanticHeavy[0]!);
  });

  it('treats a missing embedding as neutral in the blend', () => {
    const [withMissing] = hybridScores([{ lexicalScore: -1, cosine: undefined }], 0);
    expect(withMissing).toBeCloseTo(0.5, 6);
  });
});
