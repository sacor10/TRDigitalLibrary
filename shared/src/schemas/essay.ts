import { z } from 'zod';

/**
 * Frontmatter for an in-repo MDX essay/exhibit. Validated at module-load time
 * so a malformed essay fails loudly in dev rather than rendering blank.
 */
export const EssayMetaSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  author: z.string().min(1).default('TR Digital Library'),
  summary: z.string().min(1),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  relatedDocumentIds: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string().min(1)).default([]),
});

export type EssayMeta = z.infer<typeof EssayMetaSchema>;
