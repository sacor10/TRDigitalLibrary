import {
  CorrespondentGraphResponseSchema,
  DocumentListResponseSchema,
  DocumentSchema,
  DocumentSentimentSchema,
  SearchResponseSchema,
  SentimentExtremesResponseSchema,
  SentimentTimelineResponseSchema,
  TopicDetailResponseSchema,
  TopicDriftResponseSchema,
  TopicsResponseSchema,
  type CorrespondentGraphResponse,
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
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText} (${path})`);
  }
  const body = (await res.json()) as unknown;
  return parser(body);
}

export async function fetchDocuments(
  query: Partial<DocumentListQuery> = {},
): Promise<DocumentListResponse> {
  const qs = buildQuery({
    type: query.type,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    recipient: query.recipient,
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

export async function fetchCorrespondentGraph(): Promise<CorrespondentGraphResponse> {
  return getJson('/api/correspondents/graph', (raw) =>
    CorrespondentGraphResponseSchema.parse(raw),
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
    limit: query.limit,
  });
  return getJson(`/api/search${qs}`, (raw) => SearchResponseSchema.parse(raw));
}
