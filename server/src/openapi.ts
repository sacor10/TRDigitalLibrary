import {
  OpenApiGeneratorV31,
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

import {
  DocumentListQuerySchema,
  DocumentListResponseSchema,
  DocumentSchema,
  ErrorResponseSchema,
  SearchQuerySchema,
  SearchResponseSchema,
} from '@tr/shared';

extendZodWithOpenApi(z);

export function buildOpenApiDocument(): object {
  const registry = new OpenAPIRegistry();

  registry.register('Document', DocumentSchema);
  registry.register('DocumentListResponse', DocumentListResponseSchema);
  registry.register('SearchResponse', SearchResponseSchema);
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
