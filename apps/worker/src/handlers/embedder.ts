import { getDb, items, itemAnalysis } from "@fe-radar/db";
import { eq } from "drizzle-orm";
import { withScrubber } from "@fe-radar/llm";

import type { PipelineJob } from "../queues";
import { runEmbedder } from "../jobs/embedder";

import { logger, handlerContext } from "./context";
import { passesIndustryGate } from "./pipeline-gate";

export async function handleEmbedderJob(job: { data: PipelineJob }): Promise<void> {
  const db = getDb();
  const itemId = job.data.itemId;
  const correlationId = job.data.correlationId;
  logger.info({ itemId, correlationId, stage: "embedder" }, "pipeline stage");
  if (!await passesIndustryGate(db, itemId)) return;

  const [row] = await db.select({
    title: items.title,
    summaryZh: itemAnalysis.summaryZh,
  }).from(items)
    .innerJoin(itemAnalysis, eq(itemAnalysis.itemId, items.id))
    .where(eq(items.id, itemId)).limit(1);

  if (!row) return;

  // Qwen 默认 baseURL=http://localhost:8001/v1（packages/llm/src/clients/qwen.ts），
  // 本地推理不出公网：代号遮蔽零安全收益，却会把 embedding 算在 [REDACTED:PROJECT_CODE:…]
  // 文本上，而 DB 存原文 → 聚簇相似度系统性偏移；admin 增删代号后新旧向量字典不一致且
  // embedding 只算一次 → 漂移永久。故 withScrubber **不传 projectCodes**。
  // 仍走 withScrubber：INTERNAL_IP 等默认规则保留；SCRUBBER_BLOCKED 由
  // jobs/embedder.runEmbedder catch → return null（本 handler 跳过写库，不重抛）。
  const embedding = await runEmbedder(
    row.title,
    row.summaryZh ?? row.title,
    withScrubber(handlerContext.qwen),
  );
  if (embedding) {
    await db.update(itemAnalysis).set({ embedding: JSON.stringify(embedding) as unknown as number[] }).where(eq(itemAnalysis.itemId, itemId));
  }
}
