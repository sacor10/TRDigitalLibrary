import { z } from 'zod';

export const DocumentTypeSchema = z.enum([
  'letter',
  'speech',
  'diary',
  'article',
  'autobiography',
  'manuscript',
]);

export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const EARLIEST_ROOSEVELT_DOCUMENT_DATE = '1877-01-01';

export function clampRooseveltDocumentDate(date: string): string {
  return date < EARLIEST_ROOSEVELT_DOCUMENT_DATE ? EARLIEST_ROOSEVELT_DOCUMENT_DATE : date;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine((date) => date >= EARLIEST_ROOSEVELT_DOCUMENT_DATE, {
    message: `Date must not be earlier than ${EARLIEST_ROOSEVELT_DOCUMENT_DATE}`,
  });

export const TranscriptionFormatSchema = z.enum([
  'wikisource-html',
  'plain-text',
  'tei-xml',
]);

export type TranscriptionFormat = z.infer<typeof TranscriptionFormatSchema>;

export const FieldProvenanceSchema = z.object({
  sourceUrl: z.string().url().nullable(),
  fetchedAt: z.string().datetime({ offset: true }),
  editor: z.string().min(1),
});

export type FieldProvenance = z.infer<typeof FieldProvenanceSchema>;

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
  iiifManifestUrl: z.string().url().nullable().default(null),
  provenance: z.string().nullable(),
  source: z.string().min(1),
  sourceUrl: z.string().url().nullable(),
  tags: z.array(z.string()).default([]),
  mentions: z.array(z.string()).default([]),
  teiXml: z.string().nullable().default(null),
  fieldProvenance: z.record(FieldProvenanceSchema).optional(),
});

export type Document = z.infer<typeof DocumentSchema>;

export const DocumentPatchSchema = z
  .object({
    title: z.string().min(1),
    type: DocumentTypeSchema,
    date: isoDate,
    recipient: z.string().nullable(),
    location: z.string().nullable(),
    author: z.string().min(1),
    transcription: z.string(),
    transcriptionUrl: z.string().url().nullable(),
    transcriptionFormat: TranscriptionFormatSchema,
    facsimileUrl: z.string().url().nullable(),
    iiifManifestUrl: z.string().url().nullable(),
    provenance: z.string().nullable(),
    source: z.string().min(1),
    sourceUrl: z.string().url().nullable(),
    tags: z.array(z.string()),
    mentions: z.array(z.string()),
    teiXml: z.string().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'PATCH body must include at least one field',
  });

export type DocumentPatch = z.infer<typeof DocumentPatchSchema>;

export const DocumentSectionTypeSchema = z.enum([
  'div',
  'head',
  'p',
  'lg',
  'l',
  'quote',
  'list',
  'item',
  'note',
  'other',
]);

export type DocumentSectionType = z.infer<typeof DocumentSectionTypeSchema>;

export const DocumentSectionSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  parentId: z.string().nullable(),
  order: z.number().int().nonnegative(),
  level: z.number().int().nonnegative(),
  type: DocumentSectionTypeSchema,
  n: z.string().nullable(),
  heading: z.string().nullable(),
  text: z.string().default(''),
  xmlFragment: z.string().default(''),
});

export type DocumentSection = z.infer<typeof DocumentSectionSchema>;

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
  topicId: z.coerce.number().int().nonnegative().optional(),
  sort: z.enum(['date', 'title']).default('date'),
  order: z.enum(['asc', 'desc']).default('asc'),
  limit: z.coerce.number().int().positive().max(100).default(10),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;

export const SearchQuerySchema = z.object({
  q: z.string().min(1),
  type: DocumentTypeSchema.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  recipient: z.string().optional(),
  topicId: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(100).default(10),
  offset: z.coerce.number().int().nonnegative().default(0),
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

const correspondenceDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CorrespondentDirectionSchema = z.enum(['all', 'from-tr', 'to-tr']);

export type CorrespondentDirection = z.infer<typeof CorrespondentDirectionSchema>;

export const CorrespondentGraphQuerySchema = z.object({
  dateFrom: correspondenceDate.optional(),
  dateTo: correspondenceDate.optional(),
  direction: CorrespondentDirectionSchema.default('all'),
  q: z.string().optional(),
  minLetters: z.coerce.number().int().positive().max(1000).default(1),
  limit: z.coerce.number().int().positive().max(200).default(80),
});

export type CorrespondentGraphQuery = z.infer<typeof CorrespondentGraphQuerySchema>;

export const CorrespondentItemsQuerySchema = z.object({
  dateFrom: correspondenceDate.optional(),
  dateTo: correspondenceDate.optional(),
  direction: CorrespondentDirectionSchema.default('all'),
  limit: z.coerce.number().int().positive().max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export type CorrespondentItemsQuery = z.infer<typeof CorrespondentItemsQuerySchema>;

export const CorrespondentNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  totalCount: z.number().int().nonnegative(),
  inboundCount: z.number().int().nonnegative(),
  outboundCount: z.number().int().nonnegative(),
  firstDate: correspondenceDate.nullable(),
  lastDate: correspondenceDate.nullable(),
  isTR: z.boolean(),
});

export type CorrespondentNode = z.infer<typeof CorrespondentNodeSchema>;

export const CorrespondentEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  totalCount: z.number().int().nonnegative(),
  fromTrCount: z.number().int().nonnegative(),
  toTrCount: z.number().int().nonnegative(),
  firstDate: correspondenceDate.nullable(),
  lastDate: correspondenceDate.nullable(),
});

export type CorrespondentEdge = z.infer<typeof CorrespondentEdgeSchema>;

export const CorrespondentItemParticipantSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  rawName: z.string().min(1),
  role: z.enum(['creator', 'recipient']),
});

export type CorrespondentItemParticipant = z.infer<
  typeof CorrespondentItemParticipantSchema
>;

export const CorrespondentItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  date: correspondenceDate.nullable(),
  dateDisplay: z.string().nullable(),
  resourceType: z.enum(['letter', 'telegram']),
  sourceUrl: z.string().url(),
  collection: z.string().nullable(),
  creators: z.array(CorrespondentItemParticipantSchema),
  recipients: z.array(CorrespondentItemParticipantSchema),
});

export type CorrespondentItem = z.infer<typeof CorrespondentItemSchema>;

export const CorrespondentGraphResponseSchema = z.object({
  nodes: z.array(CorrespondentNodeSchema),
  edges: z.array(CorrespondentEdgeSchema),
  totalItems: z.number().int().nonnegative(),
  totalCorrespondents: z.number().int().nonnegative(),
  generatedAt: z.string().datetime({ offset: true }),
});

export type CorrespondentGraphResponse = z.infer<typeof CorrespondentGraphResponseSchema>;

export const CorrespondentItemsResponseSchema = z.object({
  items: z.array(CorrespondentItemSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export type CorrespondentItemsResponse = z.infer<typeof CorrespondentItemsResponseSchema>;
