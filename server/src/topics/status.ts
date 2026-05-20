// Tiny module holding the topic-compute status singleton and the model
// version constant. Deliberately import-free (no `./compute.js`, no
// `./embed.js`) so a static `import` from `routes/topics.ts` does not drag
// `@huggingface/transformers` into the Netlify function bundle. See the
// netlify.toml comments and `topics/embed.ts` for the other half of the
// bundle-size fix.

// Bump this string when the algorithm changes in a way that should force a
// recompute on the next boot, even if the document count is unchanged.
export const TOPIC_MODEL_VERSION = 'ts-bootstrap:Xenova/all-MiniLM-L6-v2:kmeans-v1';

export type TopicComputeStatusValue = 'idle' | 'computing' | 'ready' | 'error';

export interface TopicComputeStatus {
  status: TopicComputeStatusValue;
  progress: number;
  documentCount: number;
  computedAt: string | null;
  modelVersion: string;
  error: string | null;
}

let state: TopicComputeStatus = {
  status: 'idle',
  progress: 0,
  documentCount: 0,
  computedAt: null,
  modelVersion: TOPIC_MODEL_VERSION,
  error: null,
};

export function getComputeStatus(): TopicComputeStatus {
  return { ...state };
}

export function setComputeStatus(next: TopicComputeStatus): void {
  state = next;
}

/** @internal Test-only reset for the module-level status singleton. */
export function _resetComputeStatusForTests(): void {
  state = {
    status: 'idle',
    progress: 0,
    documentCount: 0,
    computedAt: null,
    modelVersion: TOPIC_MODEL_VERSION,
    error: null,
  };
}
