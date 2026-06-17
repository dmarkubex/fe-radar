#!/usr/bin/env tsx
/**
 * Smoke test for litigation announcement sources (CNINFO + SZSE).
 *
 * Usage:
 *   pnpm exec tsx scripts/litigation-sources-smoke.ts
 *
 * Exit 0 when each enabled source returns >= 1 item in the lookback window.
 */

import { fetchAnnouncements } from "../apps/worker/src/fetchers/announcements/index.js";
import type { AnnouncementSourceConfig } from "../apps/worker/src/fetchers/types.js";

interface LitigationSmokeSource {
  name: string;
  enabled: boolean;
  config: AnnouncementSourceConfig;
  minItems: number;
}

const LITIGATION_SMOKE_SOURCES: LitigationSmokeSource[] = [
  {
    name: "巨潮-涉诉公告",
    enabled: true,
    minItems: 1,
    config: {
      type: "announcement",
      adapter: "cninfo",
      searchkey: "诉讼",
      litigationFilter: true,
      useRealUa: true,
      pageSize: 30,
    },
  },
  {
    name: "深交所-涉诉公告",
    enabled: true,
    minItems: 1,
    config: {
      type: "announcement",
      adapter: "szse",
      litigationFilter: true,
      useRealUa: true,
      pageSize: 50,
    },
  },
  {
    name: "巨潮-C2电缆竞品涉诉",
    enabled: true,
    minItems: 0,
    config: {
      type: "announcement",
      adapter: "cninfo",
      searchkey: "诉讼",
      litigationFilter: true,
      stocks: ["600973", "600522", "600487", "605222", "002533"],
      useRealUa: true,
      pageSize: 30,
      lookbackDays: 14,
    },
  },
];

async function main(): Promise<void> {
  let failed = 0;

  for (const source of LITIGATION_SMOKE_SOURCES) {
    if (!source.enabled) {
      console.log(`SKIP ${source.name} (disabled)`);
      continue;
    }

    const started = Date.now();
    try {
      const items = await fetchAnnouncements(source.config, {
        sourceName: source.name,
        useRealUa: true,
        sourceConfig: source.config,
      });
      const elapsed = Date.now() - started;
      const ok = items.length >= source.minItems;
      const status = ok ? "PASS" : "WARN";
      console.log(
        `${status} ${source.name}: ${items.length} items (${elapsed}ms) min=${source.minItems}`
      );
      for (const item of items.slice(0, 3)) {
        console.log(`  - ${item.title.slice(0, 80)}`);
      }
      if (!ok && source.minItems > 0) {
        failed += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${source.name}:`, error instanceof Error ? error.message : error);
    }
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
