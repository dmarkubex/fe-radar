import type { ClusterDecision, ClusterInput } from "./types";

export const CLUSTER_SIMILARITY_THRESHOLD = 0.85;

export function decideCluster(input: ClusterInput): ClusterDecision {
  const best = (input.candidates ?? [])
    .map((candidate) => ({
      clusterId: candidate.clusterId,
      similarity: cosineSimilarity(input.embedding, candidate.centroid)
    }))
    .sort((a, b) => b.similarity - a.similarity)[0];

  if (!best || best.similarity < CLUSTER_SIMILARITY_THRESHOLD) {
    return { clusterId: 0, similarity: best?.similarity ?? 0, shouldCreate: true };
  }

  return { clusterId: best.clusterId, similarity: best.similarity, shouldCreate: false };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    dot += left * right;
    aNorm += left * left;
    bNorm += right * right;
  }

  if (aNorm === 0 || bNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

export interface LeadCandidate {
  itemId: number;
  tier: "T1" | "T2" | "T3";
  publishedAt: Date;
  contentLength: number;
}

const TIER_WEIGHT = { T1: 3, T2: 2, T3: 1 } as const;

export function electLeadItem(items: LeadCandidate[]): LeadCandidate | undefined {
  return [...items].sort((left, right) => {
    const tierDiff = TIER_WEIGHT[right.tier] - TIER_WEIGHT[left.tier];
    if (tierDiff !== 0) return tierDiff;
    const timeDiff = left.publishedAt.getTime() - right.publishedAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    return right.contentLength - left.contentLength;
  })[0];
}
