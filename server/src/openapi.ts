import {
  OpenApiGeneratorV31,
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import {
  CorrespondentGraphResponseSchema,
  DocumentListQuerySchema,
  DocumentListResponseSchema,
  DocumentPatchSchema,
  DocumentSchema,
  ErrorResponseSchema,
  FieldProvenanceSchema,
  SearchQuerySchema,
  SearchResponseSchema,
  TopicDetailResponseSchema,
  TopicDriftResponseSchema,
  TopicSchema,
  TopicsResponseSchema,
  DocumentSentimentSchema,
  SentimentTimelineResponseSchema,
  SentimentExtremesResponseSchema,
} from '@tr/shared';
import { z } from 'zod';


extendZodWithOpenApi(z);

export function buildOpenApiDocument(): object {
  const registry = new OpenAPIRegistry();

  registry.register('Document', DocumentSchema);
  registry.register('DocumentListResponse', DocumentListResponseSchema);
  registry.register('DocumentPatch', DocumentPatchSchema);
  registry.register('FieldProvenance', FieldProvenanceSchema);
  registry.register('SearchResponse', SearchResponseSchema);
  registry.register('CorrespondentGraphResponse', CorrespondentGraphResponseSchema);
  registry.register('Topic', TopicSchema);
  registry.register('TopicsResponse', TopicsResponseSchema);
  registry.register('TopicDetailResponse', TopicDetailResponseSchema);
  registry.register('TopicDriftResponse', TopicDriftResponseSchema);
  registry.register('DocumentSentiment', DocumentSentimentSchema);
  registry.register('SentimentTimelineResponse', SentimentTimelineResponseSchema);
  registry.register('SentimentExtremesResponse', SentimentExtremesResponseSchema);
  registry.register('Error', ErrorResponseSchema);

  registry.registerPath({
    method: 'get',
    path: '/api/documents',
    summary: 'List documents with optional filters',
    request: { query: DocumentListQuerySchema },
    responses: {
      200: {
        description: 'List of documents',
        content: { 'application/json': { schema: DocumentListResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/documents/{id}',
    summary: 'Get a single document by id',
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Document',
        content: { 'application/json': { schema: DocumentSchema } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/documents/{id}',
    summary: 'Apply a per-field correction to a document; records editor identity in provenance.',
    request: {
      params: z.object({ id: z.string() }),
      headers: z.object({
        'x-editor': z
          .string()
          .min(1)
          .describe('Editor identity recorded in field-level provenance.'),
      }),
      body: { content: { 'application/json': { schema: DocumentPatchSchema } } },
    },
    responses: {
      200: {
        description: 'Updated document with refreshed fieldProvenance.',
        content: { 'application/json': { schema: DocumentSchema } },
      },
      400: {
        description: 'Missing X-Editor header or invalid body.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
      404: {
        description: 'Document not found.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/documents/{id}/export.{ext}',
    summary:
      'Download a document as PDF, EPUB, or TEI/XML. The TEI variant returns the original `tei_xml` when present and otherwise synthesizes a minimal P5 document.',
    request: {
      params: z.object({
        id: z.string(),
        ext: z.enum(['pdf', 'epub', 'xml']).describe('pdf, epub, or xml (TEI P5)'),
      }),
    },
    responses: {
      200: {
        description: 'Binary export with Content-Disposition: attachment',
        content: {
          'application/pdf': { schema: { type: 'string', format: 'binary' } },
          'application/epub+zip': { schema: { type: 'string', format: 'binary' } },
          'application/tei+xml': { schema: { type: 'string', format: 'binary' } },
        },
      },
      404: {
        description: 'Document not found or unsupported extension',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/correspondents/graph',
    summary:
      'Network graph of letter correspondents derived from recipients and curated `mentions` per letter.',
    responses: {
      200: {
        description: 'Nodes (people), undirected edges (co-occurrence in letters), and the underlying letter index.',
        content: { 'application/json': { schema: CorrespondentGraphResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/topics',
    summary: 'List all topics produced by the most recent BERTopic run, ordered by size.',
    responses: {
      200: {
        description: 'Topics with labels, top keywords, document counts, and the model version that produced them.',
        content: { 'application/json': { schema: TopicsResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/topics/{id}',
    summary: 'Get a single topic plus its top member documents (highest probability first).',
    request: {
      params: z.object({ id: z.string().describe('Numeric topic id') }),
      query: z.object({
        limit: z
          .string()
          .optional()
          .describe('Max member documents to return; default 25, capped at 200.'),
      }),
    },
    responses: {
      200: {
        description: 'Topic + member documents.',
        content: { 'application/json': { schema: TopicDetailResponseSchema } },
      },
      404: {
        description: 'Topic not found.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/topics/drift',
    summary: 'Per-period share of each topic across the corpus, precomputed at sidecar run time.',
    request: {
      query: z.object({
        bin: z.enum(['year']).optional().describe('Drift binning granularity (only `year` supported).'),
      }),
    },
    responses: {
      200: {
        description: 'Drift points; per-period shares sum to <= 1 (HDBSCAN noise excluded).',
        content: { 'application/json': { schema: TopicDriftResponseSchema } },
      },
      400: {
        description: 'Unsupported bin granularity.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/sentiment/timeline',
    summary: 'Mean per-document VADER polarity, grouped by month or year, optionally bounded by a date range.',
    request: {
      query: z.object({
        bin: z.enum(['month', 'year']).optional().describe("Aggregation granularity; default 'month'."),
        from: z.string().optional().describe('Inclusive lower bound (YYYY-MM-DD).'),
        to: z.string().optional().describe('Inclusive upper bound (YYYY-MM-DD).'),
      }),
    },
    responses: {
      200: {
        description: 'Aggregated polarity points.',
        content: { 'application/json': { schema: SentimentTimelineResponseSchema } },
      },
      400: {
        description: 'Invalid bin or date.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/sentiment/extremes',
    summary: 'Most positive and most negative documents in an optional date range.',
    request: {
      query: z.object({
        from: z.string().optional().describe('Inclusive lower bound (YYYY-MM-DD).'),
        to: z.string().optional().describe('Inclusive upper bound (YYYY-MM-DD).'),
        limit: z.string().optional().describe('Items per side; default 10, capped at 100.'),
      }),
    },
    responses: {
      200: {
        description: 'Two ranked lists: mostPositive and mostNegative.',
        content: { 'application/json': { schema: SentimentExtremesResponseSchema } },
      },
      400: {
        description: 'Invalid date.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/sentiment/documents/{id}',
    summary: 'Per-document VADER sentiment record.',
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: 'Document sentiment.',
        content: { 'application/json': { schema: DocumentSentimentSchema } },
      },
      404: {
        description: 'No sentiment record (run `npm run sentiment`).',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/search',
    summary: 'Full-text search across documents',
    request: { query: SearchQuerySchema },
    responses: {
      200: {
        description: 'Search results with highlighted snippets',
        content: { 'application/json': { schema: SearchResponseSchema } },
      },
    },
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'TR Digital Library API',
      version: '0.1.0',
      description:
        'A read-only API for searching and reading Theodore Roosevelt’s public-domain works and correspondence.',
      license: { name: 'MIT' },
    },
    servers: [{ url: 'http://localhost:3001' }],
  });
}
