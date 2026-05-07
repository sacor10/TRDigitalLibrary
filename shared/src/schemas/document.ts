import { z } from 'zod';

export const DocumentTypeSchema = z.enum([
  'letter',
  'speech',
  'diary',
  'article',
  'autobiography',
]);

export type DocumentType = z.infer<typeof DocumentTypeSchema>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

export const TranscriptionFormatSchema = z.enum(['wikisource-html', 'plain-text']);

export type TranscriptionFormat = z.infer<typeof TranscriptionFormatSchema>;

export const DocumentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: DocumentTypeSchema,
  date: isoDate,
  recipient: z.string().nullable(),
  location: z.string().nullable(),
  author: z.string().default('Theodore Roosevelt'),
  transcription: z.string().default(''),
  transcriptionUrl: z.string().url().nullable(),
  transcriptionFormat: TranscriptionFormatSchema.default('wikisource-html'),
  facsimileUrl: z.string().url().nullable(),
  provenance: z.string().nullable(),
  source: z.string().min(1),
  sourceUrl: z.string().url().nullable(),
  tags: z.array(z.string()).default([]),
});

export type Document = z.infer<typeof DocumentSchema>;

export const DocumentListResponseSchema = z.object({
  items: z.array(DocumentSchema),
  total: z.number().int().nonnegative(),
});

export type DocumentListResponse = z.infer<typeof DocumentListResponseSchema>;

export const DocumentListQuerySchema = z.object({
  type: DocumentTypeSchema.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  recipient: z.string().optional(),
  sort: z.enum(['date', 'title']).default('date'),
  order: z.enum(['asc', 'desc']).default('asc'),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;

export const SearchQuerySchema = z.object({
  q: z.string().min(1),
  type: DocumentTypeSchema.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  recipient: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchResultSchema = z.object({
  document: DocumentSchema,
  snippet: z.string(),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SearchResponseSchema = z.object({
  results: z.array(SearchResultSchema),
  total: z.number().int().nonnegative(),
});

export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
  details: z.unknown().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
