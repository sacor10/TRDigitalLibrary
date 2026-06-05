/**
 * Lazy wrapper around a local sentence-embedding model (default
 * `Xenova/bge-small-en-v1.5`, 384-dim) via @xenova/transformers. Loaded through
 * a dynamic import so it never bloats the serverless cold start unless semantic
 * search is actually used, and so a missing model degrades gracefully to
 * lexical search instead of crashing.
 *
 * Production network policy must allow the model CDN, or weights can be
 * vendored and pointed at via EMBEDDINGS_MODEL_PATH (sets transformers.js
 * localModelPath + allowLocalModels).
 */

export const EMBEDDINGS_MODEL = process.env.EMBEDDINGS_MODEL ?? 'Xenova/bge-small-en-v1.5';
export const EMBEDDINGS_DIM = Number(process.env.EMBEDDINGS_DIM ?? 384);

// ~2000 chars keeps each chunk comfortably under the model's token limit.
const CHUNK_CHARS = 2000;

export function embeddingModelVersion(): string {
  return EMBEDDINGS_MODEL;
}

type Extractor = (
  text: string,
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array | number[] }>;

let extractorPromise: Promise<Extractor> | null = null;

async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const transformers = (await import('@xenova/transformers')) as unknown as {
        pipeline: (task: string, model: string) => Promise<Extractor>;
        env: { allowRemoteModels: boolean; allowLocalModels: boolean; localModelPath?: string };
      };
      const localPath = process.env.EMBEDDINGS_MODEL_PATH;
      if (localPath) {
        transformers.env.allowLocalModels = true;
        transformers.env.localModelPath = localPath;
      }
      return transformers.pipeline('feature-extraction', EMBEDDINGS_MODEL);
    })().catch((err) => {
      // Reset so a later call can retry (e.g. transient network failure).
      extractorPromise = null;
      throw err;
    });
  }
  return extractorPromise;
}

function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += CHUNK_CHARS) {
    chunks.push(clean.slice(i, i + CHUNK_CHARS));
  }
  return chunks;
}

/** True when an embedding model can be loaded in this environment. */
export async function embeddingsAvailable(): Promise<boolean> {
  try {
    await getExtractor();
    return true;
  } catch {
    return false;
  }
}

/**
 * Embed text into a single mean-pooled, L2-normalized vector. Long text is
 * chunked and the per-chunk vectors are averaged. Returns null if the model
 * can't be loaded.
 */
export async function embedText(text: string): Promise<Float32Array | null> {
  const chunks = chunkText(text);
  if (chunks.length === 0) return null;
  let extractor: Extractor;
  try {
    extractor = await getExtractor();
  } catch {
    return null;
  }

  const acc = new Float32Array(EMBEDDINGS_DIM);
  let count = 0;
  for (const chunk of chunks) {
    const out = await extractor(chunk, { pooling: 'mean', normalize: true });
    const data = out.data instanceof Float32Array ? out.data : Float32Array.from(out.data);
    const n = Math.min(EMBEDDINGS_DIM, data.length);
    for (let i = 0; i < n; i++) acc[i]! += data[i]!;
    count += 1;
  }
  if (count === 0) return null;

  // Average then L2-normalize so cosine == dot product downstream.
  let norm = 0;
  for (let i = 0; i < EMBEDDINGS_DIM; i++) {
    acc[i]! /= count;
    norm += acc[i]! * acc[i]!;
  }
  if (norm > 0) {
    const inv = 1 / Math.sqrt(norm);
    for (let i = 0; i < EMBEDDINGS_DIM; i++) acc[i]! *= inv;
  }
  return acc;
}
