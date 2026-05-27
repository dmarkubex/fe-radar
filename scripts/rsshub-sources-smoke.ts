/**
 * KYO-60: Smoke RSSHub finance/news routes (>=5 items with title+link).
 * Usage: RSSHUB_BASE_URL=http://127.0.0.1:1200 pnpm exec tsx scripts/rsshub-sources-smoke.ts
 */

const BASE = (process.env.RSSHUB_BASE_URL ?? "http://rsshub:1200").replace(/\/$/, "");

const ROUTES: Array<{ name: string; path: string; minItems: number; migrate: boolean }> = [
  { name: "界面新闻 能源", path: "/jiemian/lists/856", minItems: 5, migrate: true },
  { name: "第一财经 能源", path: "/yicai/headline", minItems: 5, migrate: true },
  { name: "36氪 新能源", path: "/36kr/information/web_news", minItems: 5, migrate: true },
  { name: "财联社 能源", path: "/cls/subject/1066", minItems: 5, migrate: false },
  { name: "36kr search 新能源", path: "/36kr/search/articles/新能源", minItems: 5, migrate: false },
  { name: "雪球 hots", path: "/xueqiu/hots", minItems: 5, migrate: false },
  { name: "知乎 电力话题", path: "/zhihu/topic/19577810", minItems: 5, migrate: false },
  { name: "网易 recommend", path: "/163/news/recommend", minItems: 5, migrate: false }
];

function countItems(xml: string): number {
  const matches = xml.match(/<item[\s>]/g);
  return matches?.length ?? 0;
}

async function fetchFeed(path: string): Promise<{ status: number; xml: string }> {
  const url = `${BASE}${path}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    headers: { "user-agent": "FE-Radar RSSHub Smoke (+internal)" }
  });
  return { status: response.status, xml: await response.text() };
}

async function main(): Promise<void> {
  console.log(`RSSHUB_BASE_URL=${BASE}\n`);

  let failed = false;
  const migrated: string[] = [];

  for (const route of ROUTES) {
    const { status, xml } = await fetchFeed(route.path);
    const items = status === 200 ? countItems(xml) : 0;
    const ok = status === 200 && items >= route.minItems;
    const tag = route.migrate ? "[migrate]" : "[probe] ";
    console.log(`${ok ? "PASS" : "FAIL"} ${tag} ${route.name} status=${status} items=${items} path=${route.path}`);
    if (route.migrate) {
      if (ok) migrated.push(route.name);
      else failed = true;
    }
  }

  console.log(`\nmigrated_ok=${migrated.length}/3 names=${migrated.join(", ") || "(none)"}`);
  if (failed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
