import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

export const SentimentLabelSchema = z.enum(['positive', 'neutral', 'negative']);
export type SentimentLabel = z.infer<typeof SentimentLabelSchema>;

export const SentimentBinSchema = z.enum(['month', 'year']);
export type SentimentBin = z.infer<typeof SentimentBinSchema>;

export const DocumentSentimentSchema = z.object({
  documentId: z.string().min(1),
  polarity: z.number().min(-1).max(1),
  pos: z.number().min(0).max(1),
  neu: z.number().min(0).max(1),
  neg: z.number().min(0).max(1),
  label: SentimentLabelSchema,
  sentenceCount: z.number().int().nonnegative(),
  computedAt: z.string().datetime({ offset: true }),
  modelVersion: z.string().min(1),
});

export type DocumentSentiment = z.infer<typeof DocumentSentimentSchema>;

export const SentimentTimelinePointSchema = z.object({
  period: z.string().min(1),
  meanPolarity: z.number().min(-1).max(1),
  documentCount: z.number().int().nonnegative(),
});

export type SentimentTimelinePoint = z.infer<typeof SentimentTimelinePointSchema>;

export const SentimentTimelineResponseSchema = z.object({
  bin: SentimentBinSchema,
  from: isoDate.optional(),
  to: isoDate.optional(),
  points: z.array(SentimentTimelinePointSchema),
});

export type SentimentTimelineResponse = z.infer<typeof SentimentTimelineResponseSchema>;

export const SentimentExtremeItemSchema = z.object({
  documentId: z.string().min(1),
  title: z.string().min(1),
  date: isoDate,
  polarity: z.number().min(-1).max(1),
  label: SentimentLabelSchema,
});

export type SentimentExtremeItem = z.infer<typeof SentimentExtremeItemSchema>;

export const SentimentExtremesResponseSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  mostPositive: z.array(SentimentExtremeItemSchema),
  mostNegative: z.array(SentimentExtremeItemSchema),
});

export type SentimentExtremesResponse = z.infer<typeof SentimentExtremesResponseSchema>;
