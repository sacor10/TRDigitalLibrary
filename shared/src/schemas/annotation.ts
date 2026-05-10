import { z } from 'zod';

export const AnnotationMotivationSchema = z.enum(['highlighting', 'commenting']);
export type AnnotationMotivation = z.infer<typeof AnnotationMotivationSchema>;

export const TextQuoteSelectorSchema = z.object({
  type: z.literal('TextQuoteSelector'),
  exact: z.string().min(1),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
});
export type TextQuoteSelector = z.infer<typeof TextQuoteSelectorSchema>;

export const TextPositionSelectorSchema = z.object({
  type: z.literal('TextPositionSelector'),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export type TextPositionSelector = z.infer<typeof TextPositionSelectorSchema>;

const InnerSelectorSchema = z.union([TextQuoteSelectorSchema, TextPositionSelectorSchema]);

export const FragmentSelectorSchema = z.object({
  type: z.literal('FragmentSelector'),
  value: z.string().min(1),
  refinedBy: z.union([InnerSelectorSchema, z.array(InnerSelectorSchema)]).optional(),
});
export type FragmentSelector = z.infer<typeof FragmentSelectorSchema>;

export const SelectorSchema = z.union([
  TextQuoteSelectorSchema,
  TextPositionSelectorSchema,
  FragmentSelectorSchema,
]);
export type AnnotationSelector = z.infer<typeof SelectorSchema>;

export const AnnotationTextualBodySchema = z.object({
  type: z.literal('TextualBody'),
  value: z.string(),
  format: z.literal('text/plain').optional(),
  language: z.string().optional(),
  purpose: z.literal('commenting').optional(),
});
export type AnnotationTextualBody = z.infer<typeof AnnotationTextualBodySchema>;

export const AnnotationCreatorSchema = z.object({
  id: z.string().min(1),
  type: z.literal('Person'),
  name: z.string().min(1),
});
export type AnnotationCreator = z.infer<typeof AnnotationCreatorSchema>;

export const AnnotationTargetSchema = z.object({
  source: z.string().min(1),
  selector: z.union([SelectorSchema, z.array(SelectorSchema)]),
});
export type AnnotationTarget = z.infer<typeof AnnotationTargetSchema>;

export const AnnotationSchema = z.object({
  id: z.string().min(1),
  type: z.literal('Annotation'),
  motivation: AnnotationMotivationSchema,
  body: z.array(AnnotationTextualBodySchema).optional(),
  target: AnnotationTargetSchema,
  creator: AnnotationCreatorSchema,
  created: z.string().datetime({ offset: true }),
  modified: z.string().datetime({ offset: true }),
  documentId: z.string().min(1),
  sectionId: z.string().nullable(),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const AnnotationCreateInputSchema = z.object({
  documentId: z.string().min(1),
  sectionId: z.string().min(1).nullable().optional(),
  motivation: AnnotationMotivationSchema,
  bodyText: z.string().min(1).optional(),
  target: AnnotationTargetSchema,
});
export type AnnotationCreateInput = z.infer<typeof AnnotationCreateInputSchema>;

export const AnnotationPatchSchema = z
  .object({
    bodyText: z.string().min(1),
    motivation: AnnotationMotivationSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must include at least one field',
  });
export type AnnotationPatch = z.infer<typeof AnnotationPatchSchema>;

export const AnnotationCollectionSchema = z.object({
  type: z.tuple([z.literal('BasicContainer'), z.literal('AnnotationCollection')]),
  total: z.number().int().nonnegative(),
  items: z.array(AnnotationSchema),
});
export type AnnotationCollection = z.infer<typeof AnnotationCollectionSchema>;

export const AuthUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  pictureUrl: z.string().url().nullable(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthMeResponseSchema = z.object({
  user: AuthUserSchema,
});
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

export const GoogleSignInRequestSchema = z.object({
  idToken: z.string().min(1),
});
export type GoogleSignInRequest = z.infer<typeof GoogleSignInRequestSchema>;

export const ANNOTATION_JSONLD_CONTEXT = 'http://www.w3.org/ns/anno.jsonld';
