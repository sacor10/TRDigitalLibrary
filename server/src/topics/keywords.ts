// English stopwords plus a small set of TR-correspondence filler words. The
// short list keeps top-keywords focused on substantive nouns/verbs without
// pulling in an NLP dependency.
const STOPWORDS = new Set<string>([
  'about', 'above', 'after', 'again', 'against', 'all', 'and', 'any', 'are',
  'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but',
  'cannot', 'could', 'did', 'do', 'does', 'doing', 'don', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having',
  'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'into', 'its', 'itself', 'just', 'might', 'more', 'most', 'must',
  'myself', 'nor', 'not', 'now', 'off', 'once', 'only', 'other',
  'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should',
  'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them',
  'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
  'too', 'under', 'until', 'very', 'was', 'were', 'what', 'when', 'where',
  'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would', 'you',
  'your', 'yours', 'yourself', 'yourselves',
  // TR-correspondence filler
  'upon', 'said', 'also', 'one', 'two', 'three', 'first', 'second',
  'third', 'fourth', 'fifth', 'last', 'much', 'many', 'make', 'made',
  'shall', 'though', 'thus', 'yet', 'really', 'quite', 'great', 'little',
  'good', 'old', 'new', 'long', 'men', 'man', 'dear', 'sincerely',
  'faithfully', 'truly', 'mrs', 'mr', 'sir', 'madam', 'esq', 'esquire',
  'roosevelt', 'theodore',
]);

const WORD_RE = /[a-z][a-z'-]{2,}/g;

export function tokenize(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  let match: RegExpExecArray | null;
  WORD_RE.lastIndex = 0;
  while ((match = WORD_RE.exec(lower)) !== null) {
    const tok = match[0];
    if (tok.length < 3 || tok.length > 24) continue;
    if (STOPWORDS.has(tok)) continue;
    out.push(tok);
  }
  return out;
}

export interface KeywordsInput {
  texts: string[];
  assignments: number[];
  k: number;
  topN?: number;
}

// c-TF-IDF: each cluster becomes one mega-document. TF is per-cluster token
// frequency; the "document frequency" is the number of clusters containing
// the term. Matches BERTopic's keyword-extraction stage closely enough for
// readable labels.
export function topKeywordsPerCluster(input: KeywordsInput): Map<number, string[]> {
  const { texts, assignments, k } = input;
  const topN = input.topN ?? 15;
  const clusterTokens = new Map<number, Map<string, number>>();

  for (let i = 0; i < texts.length; i++) {
    const cid = assignments[i]!;
    let bucket = clusterTokens.get(cid);
    if (!bucket) {
      bucket = new Map();
      clusterTokens.set(cid, bucket);
    }
    for (const tok of tokenize(texts[i]!)) {
      bucket.set(tok, (bucket.get(tok) ?? 0) + 1);
    }
  }

  const clusterDF = new Map<string, number>();
  for (const bucket of clusterTokens.values()) {
    for (const tok of bucket.keys()) {
      clusterDF.set(tok, (clusterDF.get(tok) ?? 0) + 1);
    }
  }

  const out = new Map<number, string[]>();
  for (let c = 0; c < k; c++) {
    const bucket = clusterTokens.get(c);
    if (!bucket || bucket.size === 0) {
      out.set(c, []);
      continue;
    }
    let total = 0;
    for (const v of bucket.values()) total += v;
    const scored: Array<[string, number]> = [];
    for (const [tok, count] of bucket) {
      const tf = count / total;
      const df = clusterDF.get(tok) ?? 1;
      const idf = Math.log((k + 1) / (df + 1)) + 1;
      scored.push([tok, tf * idf]);
    }
    scored.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    out.set(
      c,
      scored.slice(0, topN).map(([t]) => t),
    );
  }
  return out;
}

export function shortLabel(keywords: string[]): string {
  const head = keywords.slice(0, 3).filter(Boolean);
  return head.length > 0 ? head.join(', ') : 'Unlabeled';
}
