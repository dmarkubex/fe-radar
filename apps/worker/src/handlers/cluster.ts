import { getDb, itemAnalysis, clusterItems, clusters } from "@fe-radar/db";
import { eq, sql } from "drizzle-orm";

import type { PipelineJob } from "../queues";
import { createRedisConnection } from "../queues";
import { withClusterCreateLock } from "../jobs/cluster";
import { logger } from "./context";
import { passesIndustryGate } from "./pipeline-gate";

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function handleClusterJob(job: { data: PipelineJob }): Promise<void> {
  const db = getDb();
  const itemId = job.data.itemId;
  const correlationId = job.data.correlationId;
  logger.info({ itemId, correlationId, stage: "cluster" }, "pipeline stage");
  if (!await passesIndustryGate(db, itemId)) return;

  const [row] = await db.select({
    embedding: itemAnalysis.embedding,
    itemId: itemAnalysis.itemId,
  }).from(itemAnalysis).where(eq(itemAnalysis.itemId, itemId)).limit(1);

  if (!row || !row.embedding) return;

  const embedding = Array.isArray(row.embedding) ? row.embedding : JSON.parse(row.embedding as unknown as string) as number[];

  const candidates = await db.select({
    clusterId: clusters.id,
    centroid: clusters.centroid,
  }).from(clusters)
    .where(sql`${clusters.centroid} IS NOT NULL`)
    .limit(100);

  const parsedCandidates = candidates.map((c) => ({
    clusterId: c.clusterId,
    centroid: (Array.isArray(c.centroid) ? c.centroid : JSON.parse(c.centroid as unknown as string)) as number[],
  }));

  let bestCluster: { clusterId: number; similarity: number } | null = null;
  for (const candidate of parsedCandidates) {
    const sim = cosineSimilarity(embedding, candidate.centroid);
    if (sim >= 0.85 && (!bestCluster || sim > bestCluster.similarity)) {
      bestCluster = { clusterId: candidate.clusterId, similarity: sim };
    }
  }

  if (bestCluster) {
    await db.insert(clusterItems).values({
      clusterId: bestCluster.clusterId,
      itemId,
      similarity: bestCluster.similarity,
    }).onConflictDoNothing();
  } else {
    // Redis is only needed for the distributed cluster-create lock; create it
    // lazily here and always quit it so the connection isn't leaked per job.
    const redis = createRedisConnection();
    try {
      await withClusterCreateLock(redis, async () => {
        const [newCluster] = await db.insert(clusters).values({
          centroid: JSON.stringify(embedding) as unknown as number[],
          leadItemId: itemId,
        }).returning({ id: clusters.id });

        if (newCluster) {
          await db.insert(clusterItems).values({
            clusterId: newCluster.id,
            itemId,
            similarity: 1.0,
          });
        }
      });
    } finally {
      await redis.quit();
    }
  }
}
