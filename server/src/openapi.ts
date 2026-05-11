import {
  OpenApiGeneratorV31,
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import {
  ANNOTATION_JSONLD_CONTEXT,
  AnnotationCollectionSchema,
  AnnotationCreateInputSchema,
  AnnotationPatchSchema,
  AnnotationSchema,
  CorrespondentGraphResponseSchema,
  CorrespondentItemsQuerySchema,
  CorrespondentItemsResponseSchema,
  CorrespondentGraphQuerySchema,
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
  registry.register('CorrespondentItemsResponse', CorrespondentItemsResponseSchema);
  registry.register('Topic', TopicSchema);
  registry.register('TopicsResponse', TopicsResponseSchema);
  registry.register('TopicDetailResponse', TopicDetailResponseSchema);
  registry.register('TopicDriftResponse', TopicDriftResponseSchema);
  registry.register('DocumentSentiment', DocumentSentimentSchema);
  registry.register('SentimentTimelineResponse', SentimentTimelineResponseSchema);
  registry.register('SentimentExtremesResponse', SentimentExtremesResponseSchema);
  registry.register('Annotation', AnnotationSchema);
  registry.register('AnnotationCreateInput', AnnotationCreateInputSchema);
  registry.register('AnnotationPatch', AnnotationPatchSchema);
  registry.register('AnnotationCollection', AnnotationCollectionSchema);
  registry.register('Error', ErrorResponseSchema);

  const AnnotationJsonLdSchema = AnnotationSchema.omit({
    documentId: true,
    sectionId: true,
  }).extend({
    '@context': z.literal(ANNOTATION_JSONLD_CONTEXT),
  });
  registry.register('AnnotationJsonLd', AnnotationJsonLdSchema);

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
    path: '/api/documents/{id}/annotations',
    summary: 'List public annotations for a document.',
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'W3C-shaped annotation collection for the document.',
        content: { 'application/json': { schema: AnnotationCollectionSchema } },
      },
      400: {
        description: 'Missing document id.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
      404: {
        description: 'Document not found.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/annotations',
    summary: 'Create a highlight or note annotation for the signed-in user.',
    request: {
      body: { content: { 'application/json': { schema: AnnotationCreateInputSchema } } },
    },
    responses: {
      201: {
        description: 'Created annotation.',
        content: { 'application/json': { schema: AnnotationSchema } },
      },
      400: {
        description: 'Invalid body or missing required note text.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
      401: {
        description: 'Authentication required.',
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
    path: '/api/annotations/{id}',
    summary: 'Get a public annotation by id.',
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Annotation as JSON or JSON-LD, based on the Accept header.',
        content: {
          'application/json': { schema: AnnotationSchema },
          'application/ld+json': { schema: AnnotationJsonLdSchema },
        },
      },
      400: {
        description: 'Missing annotation id.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
      404: {
        description: 'Annotation not found.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/api/annotations/{id}',
    summary: 'Edit note text or convert an owned annotation between note and highlight.',
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: AnnotationPatchSchema } } },
    },
    responses: {
      200: {
        description: 'Updated annotation.',
        content: { 'application/json': { schema: AnnotationSchema } },
      },
      400: {
        description: 'Invalid body or missing required note text.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
      401: {
        description: 'Authentication required.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
      403: {
        description: 'Only the author can edit this annotation.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
      404: {
        description: 'Annotation not found.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/api/annotations/{id}',
    summary: 'Hard-delete an owned annotation.',
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      204: {
        description: 'Annotation deleted.',
      },
      400: {
        description: 'Missing annotation id.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
      401: {
        description: 'Authentication required.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
      403: {
        description: 'Only the author can delete this annotation.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
      404: {
        description: 'Annotation not found.',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/correspondents/graph',
    summary:
      'Aggregate TR ego-network graph derived from Theodore Roosevelt Center creator/recipient metadata.',
    request: { query: CorrespondentGraphQuerySchema },
    responses: {
      200: {
        description: 'Nodes and aggregate correspondence edges with counts and date spans.',
        content: { 'application/json': { schema: CorrespondentGraphResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/correspondents/{personId}/items',
    summary: 'List paginated TRC correspondence items for one correspondent.',
    request: {
      params: z.object({ personId: z.string() }),
      query: CorrespondentItemsQuerySchema,
    },
    responses: {
      200: {
        description: 'Correspondence items with creator and recipient participants.',
        content: { 'application/json': { schema: CorrespondentItemsResponseSchema } },
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
        'An API for searching, reading, and annotating Theodore Roosevelt’s public-domain works and correspondence.',
      license: { name: 'MIT' },
    },
    servers: [{ url: 'http://localhost:3001' }],
  });
}
