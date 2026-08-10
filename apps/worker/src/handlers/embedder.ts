import { getDb, items, itemAnalysis } from "@fe-radar/db";
import { eq } from "drizzle-orm";
import { withScrubber } from "@fe-radar/llm";

import type { PipelineJob } from "../queues";
import { runEmbedder } from "../jobs/embedder";

import { logger, handlerContext, loadProjectCodes } from "./context";
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

  // T-SEC-09: 项目代号字典按 job 即时加载（5min 缓存命中便宜），admin 新增代号无需重启 worker。
  const projectCodes = await loadProjectCodes();
  const embedding = await runEmbedder(row.title, row.summaryZh ?? row.title, withScrubber(handlerContext.qwen, { projectCodes }));
  if (embedding) {
    await db.update(itemAnalysis).set({ embedding: JSON.stringify(embedding) as unknown as number[] }).where(eq(itemAnalysis.itemId, itemId));
  }
}
