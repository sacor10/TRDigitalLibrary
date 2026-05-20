import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Type-only import — erased at compile time. The runtime resolution below
// uses a variable specifier so esbuild and `@vercel/nft` cannot statically
// trace `@huggingface/transformers`, keeping it (and its ~50–100 MB native
// onnxruntime / sharp chain) out of the Netlify function zip. The package
// remains in `dependencies` for local dev / build-time use.
import type { env as HFEnv, pipeline as HFPipeline } from '@huggingface/transformers';

const __dirname = (() => {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
})();

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const BATCH_SIZE = 16;
const MAX_CHARS_PER_DOC = 8000;

type Extractor = (
  inputs: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let cached: Promise<Extractor> | null = null;

function loadPipeline(): Promise<Extractor> {
  if (!cached) {
    cached = (async () => {
      // Variable indirection — the literal must not appear inside `import()`
      // or both esbuild and NFT will resolve and bundle it.
      const modSpec = '@huggingface/transformers';
      const hf = (await import(modSpec)) as {
        env: typeof HFEnv;
        pipeline: typeof HFPipeline;
      };
      // Cache HF model downloads inside the workspace. The directory is small
      // (~22MB for the quantized all-MiniLM-L6-v2) and gitignored, so a clone
      // + `npm run dev` triggers exactly one download per machine.
      hf.env.cacheDir = join(__dirname, '..', '..', '.cache', 'transformers');
      hf.env.allowLocalModels = false;
      return hf.pipeline('feature-extraction', MODEL_ID) as unknown as Extractor;
    })();
  }
  return cached;
}

export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const extractor = await loadPipeline();
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map((t) => t.slice(0, MAX_CHARS_PER_DOC));
    const result = await extractor(batch, { pooling: 'mean', normalize: true });
    const dim = result.dims[result.dims.length - 1]!;
    for (let j = 0; j < batch.length; j++) {
      const vec = new Float32Array(dim);
      vec.set(result.data.subarray(j * dim, (j + 1) * dim));
      out.push(vec);
    }
  }
  return out;
}

export type EmbedFn = typeof embedTexts;
