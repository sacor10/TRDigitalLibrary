import { EssayMetaSchema } from '@tr/shared';
import { describe, expect, it } from 'vitest';

import { ESSAYS, essaysReferencing, getEssay } from './registry';

describe('essay registry', () => {
  it('loads essays with valid frontmatter', () => {
    expect(ESSAYS.length).toBeGreaterThan(0);
    for (const { meta } of ESSAYS) {
      expect(() => EssayMetaSchema.parse(meta)).not.toThrow();
    }
  });

  it('resolves an essay by id', () => {
    const first = ESSAYS[0]!;
    expect(getEssay(first.meta.id)?.meta.title).toBe(first.meta.title);
    expect(getEssay('does-not-exist')).toBeUndefined();
  });

  it('finds essays referencing a document id', () => {
    const withRefs = ESSAYS.find((e) => e.meta.relatedDocumentIds.length > 0);
    expect(withRefs).toBeDefined();
    const docId = withRefs!.meta.relatedDocumentIds[0]!;
    const refs = essaysReferencing(docId);
    expect(refs.some((m) => m.id === withRefs!.meta.id)).toBe(true);
  });
});
