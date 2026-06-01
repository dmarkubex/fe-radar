import pino from "pino";

import { getDb, entities, scoringConfig } from "@fe-radar/db";
import type { LlmClient } from "@fe-radar/llm";
import type { ScoringConfig as CoreScoringConfig } from "@fe-radar/core";

import { EntityDictionary } from "../lib/entities-dict";
import type { BrowserContextPool } from "../fetchers/playwright";

export const logger = pino({ name: "fe-radar-worker" });

// LLM client singletons + playwright pool. These are wired by bootstrap
// (startWorker) before any worker begins processing jobs, and read by the
// pipeline handlers. Kept as a single mutable context object so handlers can
// share the same wiring without circular imports.
export interface HandlerContext {
  qwen: LlmClient;
  deepSeek: LlmClient;
  kimi: LlmClient;
  playwrightPool?: BrowserContextPool;
}

export const handlerContext: HandlerContext = {
  qwen: undefined as unknown as LlmClient,
  deepSeek: undefined as unknown as LlmClient,
  kimi: undefined as unknown as LlmClient,
  playwrightPool: undefined,
};

export async function loadScoringConfig(): Promise<CoreScoringConfig> {
  const db = getDb();
  const rows = await db.select().from(scoringConfig);
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value as Record<string, unknown>]));
  return {
    weights: (byKey.weights as CoreScoringConfig["weights"]) ?? { w1: 0.20, w2: 0.25, w3: 0.20, w4: 0.15, w5: 0.20 },
    tCoef: (byKey.t_coef as CoreScoringConfig["tCoef"]) ?? { T1: 1.0, T2: 0.85, T3: 0.70 },
    cCoef: (byKey.c_coef as CoreScoringConfig["cCoef"]) ?? { C1: 1.2, C2: 1.0, C3: 0.85 },
    thresholds: (byKey.thresholds as CoreScoringConfig["thresholds"]) ?? {
      "政策与标准": { C1: 55, C2: 60, C3: 65 },
      "市场与价格": { C1: 55, C2: 60, C3: 70 },
      "技术与产品": { C1: 55, C2: 65, C3: 75 },
      "项目与招投标": { C1: 50, C2: 60, C3: 70 },
      "公司与资本": { C1: 55, C2: 65, C3: 75 },
    },
  };
}

export async function loadEntityDictionary(): Promise<EntityDictionary> {
  const db = getDb();
  const rows = await db.select({
    id: entities.id,
    type: entities.type,
    canonicalName: entities.canonicalName,
    aliases: entities.aliases,
    circle: entities.circle,
  }).from(entities);
  return new EntityDictionary(rows.map((r) => ({
    id: r.id,
    type: r.type,
    canonicalName: r.canonicalName,
    aliases: r.aliases ?? [],
    circle: r.circle as "C1" | "C2" | "C3" | null,
  })));
}
