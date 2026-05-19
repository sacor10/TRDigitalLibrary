// K-means with cosine distance over L2-normalized embedding vectors. Used as
// the JS substitute for BERTopic's HDBSCAN+UMAP stack: it's not as good with
// outliers, but on a 500-doc corpus the clusters are coherent and every
// document lands in a topic (no noise bucket), which is what the Topic page
// needs to render without the user seeing a stub.

function cosineSim(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

function cosineDist(a: Float32Array, b: Float32Array): number {
  return 1 - cosineSim(a, b);
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function kmeansPlusPlusInit(
  vectors: Float32Array[],
  k: number,
  rng: () => number,
): number[] {
  const N = vectors.length;
  const centers: number[] = [Math.floor(rng() * N)];
  const minSqDist = new Float64Array(N).fill(Infinity);
  while (centers.length < k) {
    const last = centers[centers.length - 1]!;
    for (let i = 0; i < N; i++) {
      const d = cosineDist(vectors[i]!, vectors[last]!);
      const sq = d * d;
      if (sq < minSqDist[i]!) minSqDist[i] = sq;
    }
    let total = 0;
    for (let i = 0; i < N; i++) total += minSqDist[i]!;
    if (total === 0) {
      for (let i = 0; i < N; i++) {
        if (!centers.includes(i)) {
          centers.push(i);
          break;
        }
      }
      continue;
    }
    let r = rng() * total;
    let picked = -1;
    for (let i = 0; i < N; i++) {
      r -= minSqDist[i]!;
      if (r <= 0) {
        picked = i;
        break;
      }
    }
    if (picked < 0) picked = N - 1;
    centers.push(picked);
  }
  return centers;
}

function meanVector(vectors: Float32Array[], indices: number[]): Float32Array {
  const dim = vectors[0]!.length;
  const sum = new Float32Array(dim);
  if (indices.length === 0) return sum;
  for (const i of indices) {
    const v = vectors[i]!;
    for (let j = 0; j < dim; j++) sum[j] = sum[j]! + v[j]!;
  }
  let norm = 0;
  for (let j = 0; j < dim; j++) {
    sum[j] = sum[j]! / indices.length;
    norm += sum[j]! * sum[j]!;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let j = 0; j < dim; j++) sum[j] = sum[j]! / norm;
  }
  return sum;
}

export interface ClusterResult {
  assignments: number[];
  centroids: Float32Array[];
  silhouette: number;
}

function farthestUnassignedIndex(
  vectors: Float32Array[],
  centroids: Float32Array[],
): number {
  let bestIdx = 0;
  let bestDist = -Infinity;
  for (let i = 0; i < vectors.length; i++) {
    let nearest = Infinity;
    for (const c of centroids) {
      const d = cosineDist(vectors[i]!, c);
      if (d < nearest) nearest = d;
    }
    if (nearest > bestDist) {
      bestDist = nearest;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function kmeans(
  vectors: Float32Array[],
  k: number,
  seed: number,
  maxIter = 50,
): ClusterResult {
  const N = vectors.length;
  const dim = vectors[0]!.length;
  const rng = mulberry32(seed);
  const initIndices = kmeansPlusPlusInit(vectors, k, rng);
  let centroids: Float32Array[] = initIndices.map((i) => {
    const v = new Float32Array(dim);
    v.set(vectors[i]!);
    return v;
  });
  const assignments = new Array<number>(N).fill(-1);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = 0;
    for (let i = 0; i < N; i++) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = cosineDist(vectors[i]!, centroids[c]!);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        changed++;
      }
    }
    if (changed === 0 && iter > 0) break;

    const newCentroids: Float32Array[] = [];
    for (let c = 0; c < k; c++) {
      const members: number[] = [];
      for (let i = 0; i < N; i++) if (assignments[i] === c) members.push(i);
      if (members.length === 0) {
        const idx = farthestUnassignedIndex(vectors, centroids);
        const v = new Float32Array(dim);
        v.set(vectors[idx]!);
        newCentroids.push(v);
      } else {
        newCentroids.push(meanVector(vectors, members));
      }
    }
    centroids = newCentroids;
  }
  return {
    assignments,
    centroids,
    silhouette: silhouetteScore(vectors, assignments, k),
  };
}

// Sampled silhouette: full O(N^2) is unaffordable for 500+ docs, and the
// sampled score is good enough for *picking among k values*.
function silhouetteScore(
  vectors: Float32Array[],
  assignments: number[],
  k: number,
): number {
  if (k <= 1) return 0;
  const N = vectors.length;
  const members: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < N; i++) members[assignments[i]!]!.push(i);
  const sampleSize = Math.min(N, 200);
  const stride = Math.max(1, Math.floor(N / sampleSize));
  let total = 0;
  let count = 0;
  for (let i = 0; i < N; i += stride) {
    const own = assignments[i]!;
    if (members[own]!.length < 2) continue;
    let aSum = 0;
    for (const j of members[own]!) if (j !== i) aSum += cosineDist(vectors[i]!, vectors[j]!);
    const a = aSum / (members[own]!.length - 1);
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === own || members[c]!.length === 0) continue;
      let bSum = 0;
      for (const j of members[c]!) bSum += cosineDist(vectors[i]!, vectors[j]!);
      const bMean = bSum / members[c]!.length;
      if (bMean < b) b = bMean;
    }
    if (!isFinite(b)) continue;
    const denom = Math.max(a, b);
    if (denom > 0) {
      total += (b - a) / denom;
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

export interface ClusterOptions {
  minK?: number;
  maxK?: number;
  seed?: number;
}

export function selectAndCluster(
  vectors: Float32Array[],
  opts: ClusterOptions = {},
): ClusterResult {
  const N = vectors.length;
  const seed = opts.seed ?? 42;
  if (N === 0) return { assignments: [], centroids: [], silhouette: 0 };
  if (N === 1) return { assignments: [0], centroids: [vectors[0]!], silhouette: 0 };
  if (N === 2) {
    return {
      assignments: [0, 1],
      centroids: [vectors[0]!, vectors[1]!],
      silhouette: 0,
    };
  }
  // Scale k-bounds with corpus size so small fixtures don't over-split.
  // On a 500-doc corpus this matches the planned minK=8 / maxK=25; on a
  // 16-doc fixture it shrinks to minK=2 / maxK=3 so all three themes can
  // land in one cluster each.
  const defaultMaxK = Math.max(2, Math.min(25, Math.floor(N / 5)));
  const defaultMinK = Math.max(2, Math.min(8, Math.floor(N / 20)));
  const upper = Math.min(opts.maxK ?? defaultMaxK, N - 1);
  const lower = Math.max(2, Math.min(opts.minK ?? defaultMinK, upper));
  // Coarse sweep so we try a handful of k values without paying O(N^2) per k.
  const candidates: number[] = [];
  const span = Math.max(1, upper - lower);
  const stepCount = Math.min(6, span);
  for (let s = 0; s <= stepCount; s++) {
    const k = Math.round(lower + (span * s) / stepCount);
    if (!candidates.includes(k)) candidates.push(k);
  }
  let best: ClusterResult | null = null;
  for (const k of candidates) {
    const r = kmeans(vectors, k, seed);
    if (!best || r.silhouette > best.silhouette) best = r;
  }
  return best!;
}
