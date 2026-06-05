import { EssayMetaSchema, type EssayMeta } from '@tr/shared';
import type { ComponentType } from 'react';

/** Compiled MDX body component; accepts a `components` override map. */
export type MdxComponent = ComponentType<{ components?: Record<string, unknown> }>;

// Frontmatter is imported eagerly (tiny, needed for listing + document
// cross-links); the MDX body components are code-split and loaded on demand.
const frontmatterModules = import.meta.glob('./*.mdx', {
  eager: true,
  import: 'frontmatter',
}) as Record<string, unknown>;

const componentLoaders = import.meta.glob('./*.mdx', {
  import: 'default',
}) as Record<string, () => Promise<{ default: MdxComponent }>>;

export interface EssayEntry {
  meta: EssayMeta;
  /** Lazily import the compiled MDX body component. */
  load: () => Promise<MdxComponent>;
}

function buildRegistry(): EssayEntry[] {
  const entries: EssayEntry[] = [];
  for (const [path, rawFrontmatter] of Object.entries(frontmatterModules)) {
    const parsed = EssayMetaSchema.safeParse(rawFrontmatter);
    if (!parsed.success) {
      // Fail loudly in dev; skip in prod so one bad essay can't blank the page.
      if (import.meta.env.DEV) {
        throw new Error(`Invalid essay frontmatter in ${path}: ${parsed.error.message}`);
      }
      continue;
    }
    const loader = componentLoaders[path];
    if (!loader) continue;
    entries.push({
      meta: parsed.data,
      load: async () => (await loader()).default,
    });
  }
  return entries.sort((a, b) => a.meta.title.localeCompare(b.meta.title));
}

export const ESSAYS: EssayEntry[] = buildRegistry();

export function getEssay(id: string): EssayEntry | undefined {
  return ESSAYS.find((entry) => entry.meta.id === id);
}

/** Essays that reference a given document id (for the document detail page). */
export function essaysReferencing(documentId: string): EssayMeta[] {
  return ESSAYS.filter((entry) => entry.meta.relatedDocumentIds.includes(documentId)).map(
    (entry) => entry.meta,
  );
}
