import { z } from 'zod';

import { DocumentSchema } from './document.js';

/** A user-owned research list ("collection") of saved documents. */
export const CollectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  isPublic: z.boolean(),
  ownerName: z.string().min(1),
  itemCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  modifiedAt: z.string().datetime({ offset: true }),
});

export type Collection = z.infer<typeof CollectionSchema>;

/** A saved document within a collection, hydrated with its document summary. */
export const CollectionItemSchema = z.object({
  document: DocumentSchema,
  note: z.string().nullable(),
  addedAt: z.string().datetime({ offset: true }),
});

export type CollectionItem = z.infer<typeof CollectionItemSchema>;

export const CollectionDetailSchema = CollectionSchema.extend({
  items: z.array(CollectionItemSchema),
});

export type CollectionDetail = z.infer<typeof CollectionDetailSchema>;

export const CollectionsListResponseSchema = z.object({
  items: z.array(CollectionSchema),
});

export type CollectionsListResponse = z.infer<typeof CollectionsListResponseSchema>;

export const CollectionCreateInputSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  isPublic: z.boolean().optional().default(false),
});

export type CollectionCreateInput = z.infer<typeof CollectionCreateInputSchema>;

export const CollectionPatchSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).nullable(),
    isPublic: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must include at least one field',
  });

export type CollectionPatch = z.infer<typeof CollectionPatchSchema>;

export const CollectionItemInputSchema = z.object({
  documentId: z.string().min(1),
  note: z.string().max(2000).nullish(),
});

export type CollectionItemInput = z.infer<typeof CollectionItemInputSchema>;
