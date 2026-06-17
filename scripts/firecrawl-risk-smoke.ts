#!/usr/bin/env tsx
/**
 * Smoke test for Firecrawl C1 risk search source.
 *
 * Usage:
 *   FIRECRAWL_API_KEY=fc-xxx pnpm exec tsx scripts/firecrawl-risk-smoke.ts
 *
 * Skips with exit 0 when FIRECRAWL_API_KEY is unset.
 */

import { fetchCrawl } from "../apps/worker/src/fetchers/crawl/index.js";
import type { CrawlSourceConfig } from "../apps/worker/src/fetchers/crawl/types.js";

const SMOKE_CONFIG: CrawlSourceConfig = {
  type: "crawl",
  adapter: "firecrawl",
  queries: ["远东控股 诉讼", "远东电缆 行政处罚"],
  limit: 3,
  country: "CN",
  location: "China",
  tbs: "qdr:w",
  riskFilter: true,
  entityKeywords: ["远东控股", "远东电缆", "远东智慧能源", "远东股份", "远东"],
  riskKeywords: ["诉讼", "仲裁", "判决", "处罚", "罚款", "失信", "被执行", "事故", "质量", "抽检", "不合格", "召回", "舆情", "负面"],
  includeDomains: [
    "news.bjx.com.cn",
    "www.cls.cn",
    "finance.sina.com.cn",
    "www.stcn.com",
    "www.gov.cn",
    "www.nea.gov.cn",
    "www.ndrc.gov.cn",
    "www.miit.gov.cn",
  ],
};

async function main(): Promise<void> {
  if (!process.env.FIRECRAWL_API_KEY?.trim()) {
    console.log("SKIP: FIRECRAWL_API_KEY not set");
    return;
  }

  const started = Date.now();
  const items = await fetchCrawl(SMOKE_CONFIG, { sourceName: "Firecrawl-C1风险检索-smoke" });
  console.log(`PASS: ${items.length} items (${Date.now() - started}ms)`);
  for (const item of items.slice(0, 5)) {
    console.log(`  - ${item.title.slice(0, 80)}`);
    console.log(`    ${item.url}`);
  }

  if (items.length === 0) {
    console.warn("WARN: zero results — check query/domain filters or API quota");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
