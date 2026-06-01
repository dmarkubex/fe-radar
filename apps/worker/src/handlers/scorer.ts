import { getDb, items, itemAnalysis } from "@fe-radar/db";
import { eq } from "drizzle-orm";
import { withScrubber } from "@fe-radar/llm";

import type { PipelineJob } from "../queues";
import { runScorer } from "../jobs/scorer";

import { logger, handlerContext } from "./context";

export async function handleScorerJob(job: { data: PipelineJob }): Promise<void> {
  const db = getDb();
  const itemId = job.data.itemId;
  const correlationId = job.data.correlationId;
  logger.info({ itemId, correlationId, stage: "scorer" }, "pipeline stage");
  const [row] = await db.select({
    title: items.title,
    content: items.content,
  }).from(items).where(eq(items.id, itemId)).limit(1);

  if (!row) return;

  const text = `${row.title}\n${row.content ?? ""}`;
  const result = await runScorer(text, withScrubber(handlerContext.deepSeek));

  await db.update(itemAnalysis).set({
    d1Policy: result.d1Policy,
    d3Market: result.d3Market,
    d4Tech: result.d4Tech,
    d5Business: result.d5Business,
    summaryZh: result.summaryZh,
    translationZh: result.translationZh,
    category: result.category,
  }).where(eq(itemAnalysis.itemId, itemId));
}
