import {
  AnnotationCollectionSchema,
  AnnotationSchema,
  AuthMeResponseSchema,
  CorrespondentGraphResponseSchema,
  CorrespondentItemsResponseSchema,
  DocumentListResponseSchema,
  DocumentSchema,
  DocumentSentimentSchema,
  SearchResponseSchema,
  SentimentExtremesResponseSchema,
  SentimentTimelineResponseSchema,
  TopicDetailResponseSchema,
  TopicDriftResponseSchema,
  TopicsResponseSchema,
  type Annotation,
  type AnnotationCollection,
  type AnnotationCreateInput,
  type AnnotationPatch,
  type AuthUser,
  type CorrespondentGraphResponse,
  type CorrespondentGraphQuery,
  type CorrespondentItemsQuery,
  type CorrespondentItemsResponse,
  type Document,
  type DocumentListQuery,
  type DocumentListResponse,
  type DocumentSentiment,
  type SearchQuery,
  type SearchResponse,
  type SentimentBin,
  type SentimentExtremesResponse,
  type SentimentTimelineResponse,
  type TopicDetailResponse,
  type TopicDriftResponse,
  type TopicsResponse,
} from '@tr/shared';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

function buildQuery(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  const search = new URLSearchParams();
  for (const [k, v] of entries) {
    search.set(k, String(v));
  }
  return `?${search.toString()}`;
}

async function getJson<T>(path: string, parser: (raw: unknown) => T): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText} (${path})`);
  }
  const body = (await res.json()) as unknown;
  return parser(body);
}

async function sendJson<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  parser: ((raw: unknown) => T) | null,
): Promise<T | null> {
  const init: RequestInit = { method, credentials: 'include' };
  if (body != null) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const errBody = (await res.json()) as { error?: string };
      if (errBody.error) detail = errBody.error;
    } catch {
      /* ignore */
    }
    throw new Error(`${method} ${path} failed: ${detail}`);
  }
  if (res.status === 204 || !parser) return null;
  const raw = (await res.json()) as unknown;
  return parser(raw);
}

export async function fetchDocuments(
  query: Partial<DocumentListQuery> = {},
): Promise<DocumentListResponse> {
  const qs = buildQuery({
    type: query.type,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    recipient: query.recipient,
    topicId: query.topicId,
    sort: query.sort,
    order: query.order,
    limit: query.limit,
    offset: query.offset,
  });
  return getJson(`/api/documents${qs}`, (raw) => DocumentListResponseSchema.parse(raw));
}

export async function fetchDocument(id: string): Promise<Document> {
  return getJson(`/api/documents/${encodeURIComponent(id)}`, (raw) => DocumentSchema.parse(raw));
}

export type ExportFormat = 'pdf' | 'epub' | 'tei';

export function documentExportUrl(id: string, format: ExportFormat): string {
  const ext = format === 'tei' ? 'xml' : format;
  return `${API_BASE}/api/documents/${encodeURIComponent(id)}/export.${ext}`;
}

export async function fetchCorrespondentGraph(
  query: Partial<CorrespondentGraphQuery> = {},
): Promise<CorrespondentGraphResponse> {
  const qs = buildQuery({
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    direction: query.direction,
    q: query.q,
    minLetters: query.minLetters,
    limit: query.limit,
  });
  return getJson(`/api/correspondents/graph${qs}`, (raw) =>
    CorrespondentGraphResponseSchema.parse(raw),
  );
}

export async function fetchCorrespondentItems(
  personId: string,
  query: Partial<CorrespondentItemsQuery> = {},
): Promise<CorrespondentItemsResponse> {
  const qs = buildQuery({
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    direction: query.direction,
    limit: query.limit,
    offset: query.offset,
  });
  return getJson(`/api/correspondents/${encodeURIComponent(personId)}/items${qs}`, (raw) =>
    CorrespondentItemsResponseSchema.parse(raw),
  );
}

export async function fetchTopics(): Promise<TopicsResponse> {
  return getJson('/api/topics', (raw) => TopicsResponseSchema.parse(raw));
}

export async function fetchTopic(id: number, limit?: number): Promise<TopicDetailResponse> {
  const qs = buildQuery({ limit });
  return getJson(`/api/topics/${id}${qs}`, (raw) => TopicDetailResponseSchema.parse(raw));
}

export async function fetchTopicDrift(): Promise<TopicDriftResponse> {
  return getJson('/api/topics/drift?bin=year', (raw) => TopicDriftResponseSchema.parse(raw));
}

export interface SentimentTimelineQuery {
  bin?: SentimentBin;
  from?: string;
  to?: string;
}

export async function fetchSentimentTimeline(
  query: SentimentTimelineQuery = {},
): Promise<SentimentTimelineResponse> {
  const qs = buildQuery({ bin: query.bin, from: query.from, to: query.to });
  return getJson(`/api/sentiment/timeline${qs}`, (raw) =>
    SentimentTimelineResponseSchema.parse(raw),
  );
}

export async function fetchSentimentExtremes(query: {
  from?: string;
  to?: string;
  limit?: number;
}): Promise<SentimentExtremesResponse> {
  const qs = buildQuery({ from: query.from, to: query.to, limit: query.limit });
  return getJson(`/api/sentiment/extremes${qs}`, (raw) =>
    SentimentExtremesResponseSchema.parse(raw),
  );
}

export async function fetchDocumentSentiment(id: string): Promise<DocumentSentiment | null> {
  const res = await fetch(`${API_BASE}/api/sentiment/documents/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return DocumentSentimentSchema.parse(await res.json());
}

export async function searchDocuments(query: SearchQuery): Promise<SearchResponse> {
  const qs = buildQuery({
    q: query.q,
    type: query.type,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    recipient: query.recipient,
    topicId: query.topicId,
    limit: query.limit,
    offset: query.offset,
  });
  return getJson(`/api/search${qs}`, (raw) => SearchResponseSchema.parse(raw));
}

export async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  const parsed = AuthMeResponseSchema.parse(await res.json());
  return parsed.user;
}

export async function googleSignIn(idToken: string): Promise<AuthUser> {
  const result = await sendJson(
    'POST',
    '/api/auth/google',
    { idToken },
    (raw) => AuthMeResponseSchema.parse(raw),
  );
  if (!result) throw new Error('Empty sign-in response');
  return result.user;
}

export async function logout(): Promise<void> {
  await sendJson('POST', '/api/auth/logout', null, null);
}

export async function listDocumentAnnotations(
  documentId: string,
): Promise<AnnotationCollection> {
  return getJson(
    `/api/documents/${encodeURIComponent(documentId)}/annotations`,
    (raw) => AnnotationCollectionSchema.parse(raw),
  );
}

export async function getAnnotation(id: string): Promise<Annotation> {
  return getJson(`/api/annotations/${encodeURIComponent(id)}`, (raw) =>
    AnnotationSchema.parse(raw),
  );
}

export async function createAnnotation(input: AnnotationCreateInput): Promise<Annotation> {
  const result = await sendJson('POST', '/api/annotations', input, (raw) =>
    AnnotationSchema.parse(raw),
  );
  if (!result) throw new Error('Empty create response');
  return result;
}

export async function patchAnnotation(
  id: string,
  patch: AnnotationPatch,
): Promise<Annotation> {
  const result = await sendJson(
    'PATCH',
    `/api/annotations/${encodeURIComponent(id)}`,
    patch,
    (raw) => AnnotationSchema.parse(raw),
  );
  if (!result) throw new Error('Empty patch response');
  return result;
}

export async function deleteAnnotation(id: string): Promise<void> {
  await sendJson('DELETE', `/api/annotations/${encodeURIComponent(id)}`, null, null);
}

export function annotationJsonLdUrl(id: string): string {
  return `${API_BASE}/api/annotations/${encodeURIComponent(id)}`;
}
