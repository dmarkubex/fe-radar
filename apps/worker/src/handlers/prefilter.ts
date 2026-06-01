import { getDb, items, itemAnalysis } from "@fe-radar/db";
import { eq } from "drizzle-orm";
import { withScrubber } from "@fe-radar/llm";

import type { PipelineJob } from "../queues";
import { runPrefilter } from "../jobs/prefilter";

import { logger, handlerContext } from "./context";

export async function handlePrefilterJob(job: { data: PipelineJob }): Promise<void> {
  const db = getDb();
  const itemId = job.data.itemId;
  const correlationId = job.data.correlationId;
  logger.info({ itemId, correlationId, stage: "prefilter" }, "pipeline stage");
  const [row] = await db.select({
    title: items.title,
    content: items.content,
  }).from(items).where(eq(items.id, itemId)).limit(1);

  if (!row) {
    logger.warn({ itemId, correlationId, stage: "prefilter" }, "item not found for prefilter");
    return;
  }

  const result = await runPrefilter(
    { title: row.title, content: row.content ?? row.title },
    withScrubber(handlerContext.qwen),
    withScrubber(handlerContext.deepSeek),
  );

  await db.update(itemAnalysis).set({
    isIndustryRelated: result.isIndustryRelated === true,
  }).where(eq(itemAnalysis.itemId, itemId));
}
