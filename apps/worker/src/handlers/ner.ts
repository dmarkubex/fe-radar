import { getDb, items, itemEntities, entities } from "@fe-radar/db";
import { eq, and } from "drizzle-orm";
import { withScrubber } from "@fe-radar/llm";

import type { PipelineJob } from "../queues";
import { runNer } from "../jobs/ner";

import { logger, handlerContext, loadEntityDictionary } from "./context";

export async function handleNerJob(job: { data: PipelineJob }): Promise<void> {
  const db = getDb();
  const itemId = job.data.itemId;
  const correlationId = job.data.correlationId;
  logger.info({ itemId, correlationId, stage: "ner" }, "pipeline stage");
  const [row] = await db.select({
    title: items.title,
    content: items.content,
  }).from(items).where(eq(items.id, itemId)).limit(1);

  if (!row) return;

  const text = `${row.title}\n${row.content ?? ""}`;
  const dict = await loadEntityDictionary();
  const result = await runNer(
    text,
    dict,
    withScrubber(handlerContext.qwen),
    withScrubber(handlerContext.deepSeek),
  );

  for (const entity of result.entities) {
    if (entity.canonicalName) {
      const [existing] = await db.select({ id: entities.id }).from(entities)
        .where(and(eq(entities.type, entity.type), eq(entities.canonicalName, entity.canonicalName)))
        .limit(1);
      if (existing) {
        await db.insert(itemEntities).values({ itemId, entityId: existing.id, span: entity.text }).onConflictDoNothing();
      }
    }
  }
}
