/**
 * 全量信源抓取审计：用 worker 真实 fetcher 逻辑探测每条源能否产出条目。
 * 用法：pnpm tsx scripts/sources-fetch-audit.ts
 * 环境：GOV_HTML_SMOKE_SKIP=1 跳过（仅打印清单）
 */
import { fetchAnnouncements } from "../apps/worker/src/fetchers/announcements/index.js";
import { fetchHtml } from "../apps/worker/src/fetchers/html.js";
import { fetchPlaywright, createPlaywrightPool } from "../apps/worker/src/fetchers/playwright.js";
import { fetchRss } from "../apps/worker/src/fetchers/rss.js";
import type { SourceConfig } from "../apps/worker/src/fetchers/types.js";

interface AuditSource {
  name: string;
  tier: string;
  enabled: boolean;
  note?: string;
  config: SourceConfig;
}

/** migration 叠加后的预期配置（2026-06，含 0022 北极星 html + 0023 信源刷新） */
const SOURCES: AuditSource[] = [
  // T1 政府
  { name: "国家能源局", tier: "T1", enabled: true, config: { type: "html", listUrl: "https://www.nea.gov.cn/xwzx/index.htm", useRealUa: true, selectors: { item: ".list01 li", title: "a", link: "a", date: "span" } } },
  { name: "国家发改委", tier: "T1", enabled: false, note: "0014 禁用：机房网络不可达", config: { type: "html", listUrl: "https://www.ndrc.gov.cn/xwdt/xwfb/", selectors: { item: "ul.u-list > li", title: "a", link: "a", date: "span" } } },
  { name: "工信部", tier: "T1", enabled: false, note: "0014 禁用", config: { type: "html", listUrl: "https://www.miit.gov.cn/xwdt/gxdt/index.html", selectors: { item: ".list ul li, .cata-list li", title: "a", link: "a", date: "span" } } },
  // T1 协会
  { name: "中电联", tier: "T1", enabled: false, note: "0014 禁用", config: { type: "html", listUrl: "https://www.cec.org.cn/yaowen/index.jhtml", selectors: { item: ".list-ul li, ul.list li, #list li", title: "a", link: "a", date: "span" } } },
  { name: "中国电器工业协会", tier: "T1", enabled: true, config: { type: "html", listUrl: "http://www.ceeia.com/news/", selectors: { item: ".notice-list.tab-con.active p.text-of", title: "a", link: "a", date: "span" } } },
  { name: "中关村储能产业技术联盟 CNESA", tier: "T1", enabled: false, note: "0014 selector 0 条", config: { type: "html", listUrl: "http://www.cnesa.org/index/news", selectors: { item: "article.et-item", title: "a", link: "a", date: "time" } } },
  { name: "中国可再生能源学会风能专业委员会 CWEA", tier: "T1", enabled: false, note: "0023 禁用：news_lastest.js 动态加载", config: { type: "html", listUrl: "http://www.cwea.org.cn/news_lastest.html", selectors: { item: "li", title: "a", link: "a", date: "span" } } },
  { name: "中国光伏行业协会 CPIA", tier: "T1", enabled: true, config: { type: "html", listUrl: "http://www.chinapv.org.cn/", useRealUa: true, selectors: { item: ".news li", title: "a", link: "a", date: "span" } } },
  // T1 公告
  { name: "上交所公告", tier: "T1", enabled: false, note: "0013 SSE 不稳定", config: { type: "announcement", adapter: "sse", endpoint: "http://query.sse.com.cn/security/stock/queryCompanyBulletin.do" } },
  { name: "深交所公告", tier: "T1", enabled: true, config: { type: "announcement", adapter: "szse" } },
  { name: "巨潮资讯公告", tier: "T1", enabled: true, config: { type: "announcement", adapter: "cninfo" } },
  // T2 北极星（0022 html）
  { name: "北极星电力新闻网", tier: "T2", enabled: true, config: { type: "html", listUrl: "https://www.bjx.com.cn/", selectors: { item: '.cc-ul-dot li a[href*="news.bjx.com.cn/html"]', title: "a", link: "a", date: "" } } },
  { name: "北极星储能网", tier: "T2", enabled: true, config: { type: "html", listUrl: "https://chuneng.bjx.com.cn/", selectors: { item: ".cc-ul-dot li", title: "a", link: "a", date: "" } } },
  { name: "北极星输配电网", tier: "T2", enabled: true, config: { type: "html", listUrl: "https://shupeidian.bjx.com.cn/", selectors: { item: ".cc-ul-dot li", title: "a", link: "a", date: "" } } },
  { name: "北极星太阳能光伏网", tier: "T2", enabled: true, config: { type: "html", listUrl: "https://www.bjx.com.cn/", selectors: { item: '.cc-ul-dot li a[href*="guangfu.bjx.com.cn"]', title: "a", link: "a", date: "" } } },
  { name: "北极星风力发电网", tier: "T2", enabled: true, config: { type: "html", listUrl: "https://fd.bjx.com.cn/", selectors: { item: ".cc-ul-dot li", title: "a", link: "a", date: "" } } },
  { name: "北极星售电网", tier: "T2", enabled: true, config: { type: "html", listUrl: "https://shoudian.bjx.com.cn/", selectors: { item: ".cc-ul-dot li", title: "a", link: "a", date: "" } } },
  { name: "北极星智能电网在线", tier: "T2", enabled: false, note: "0011 SSL 失败", config: { type: "playwright", listUrl: "https://smartgrid.bjx.com.cn/", waitFor: "body", extractor: "() => []" } },
  { name: "电缆网 cableabc", tier: "T2", enabled: false, note: "0004 TLS 失败", config: { type: "html", listUrl: "https://www.cableabc.com/news/", selectors: { item: "li", title: "a", link: "a", date: "span" } } },
  { name: "中国电力新闻网", tier: "T2", enabled: true, config: { type: "html", listUrl: "http://www.cpnn.com.cn/", selectors: { item: "ul.infoList > li", title: "a", link: "a", date: "span" } } },
  { name: "中国能源报", tier: "T2", enabled: false, note: "0023 禁用：paper.people.com.cn 403", config: { type: "html", listUrl: "https://paper.people.com.cn/zgnyb/", selectors: { item: "a", title: "a", link: "a", date: "span" } } },
  { name: "索比光伏网", tier: "T2", enabled: false, note: "0017 robots Disallow /news/", config: { type: "html", listUrl: "https://www.solarbe.com/news/", selectors: { item: '.xNews_left a[href*="news.solarbe.com/20"]', title: "a", link: "a", date: "span" } } },
  { name: "储能网 escn", tier: "T2", enabled: true, config: { type: "html", listUrl: "https://www.escn.com.cn/", useRealUa: true, selectors: { item: ".xinwenConBox a", title: "a", link: "a", date: "" } } },
  { name: "高工储能", tier: "T2", enabled: true, config: { type: "html", listUrl: "https://www.estv.com.cn/", useRealUa: true, selectors: { item: ".Es_New_1_m_li", title: "a", link: "a", date: "span" } } },
  { name: "国际能源网", tier: "T2", enabled: true, config: { type: "html", listUrl: "https://www.in-en.com/news/", selectors: { item: "ul.infoList > li", title: ".listTxt h5 a", link: "a", date: "span" } } },
  { name: "电缆头条", tier: "T2", enabled: false, note: "0023 禁用：robots /weixin", config: { type: "playwright", listUrl: "https://weixin.sogou.com/weixin?type=1&query=%E7%94%B5%E7%BC%86%E5%A4%B4%E6%9D%A1", waitFor: "body", extractor: "() => Array.from(document.querySelectorAll('a')).slice(0,10).map(a => ({ title: a.textContent.trim(), url: a.href }))" } },
  { name: "储能头条", tier: "T2", enabled: false, note: "0023 禁用：robots /weixin", config: { type: "playwright", listUrl: "https://weixin.sogou.com/weixin?type=1&query=%E5%82%A8%E8%83%BD%E5%A4%B4%E6%9D%A1", waitFor: "body", extractor: "() => Array.from(document.querySelectorAll('a')).slice(0,10).map(a => ({ title: a.textContent.trim(), url: a.href }))" } },
  { name: "中国电网 china-power", tier: "T2", enabled: false, note: "0023 禁用：域名 404", config: { type: "html", listUrl: "http://www.china-power.com.cn/", selectors: { item: "li", title: "a", link: "a", date: "span" } } },
  // T3
  { name: "财联社 能源", tier: "T3", enabled: true, config: { type: "html", listUrl: "https://www.cls.cn/subject/1066", selectors: { item: "a", title: "a", link: "a", date: "span" } } },
  { name: "界面新闻 能源", tier: "T3", enabled: true, note: "0015 需内网 RSSHub", config: { type: "rss", url: "http://rsshub:1200/jiemian/lists/856" } },
  { name: "第一财经 能源", tier: "T3", enabled: true, note: "0015 需内网 RSSHub", config: { type: "rss", url: "http://rsshub:1200/yicai/headline" } },
  { name: "36氪 新能源", tier: "T3", enabled: true, note: "0015 需内网 RSSHub", config: { type: "rss", url: "http://rsshub:1200/36kr/information/web_news" } },
  { name: "凤凰财经 能源", tier: "T3", enabled: true, config: { type: "html", listUrl: "https://finance.ifeng.com/", selectors: { item: "a", title: "a", link: "a", date: "span" } } },
  { name: "钛媒体 新能源", tier: "T3", enabled: true, config: { type: "html", listUrl: "https://www.tmtpost.com/nictation", useRealUa: true, selectors: { item: 'a[href*="/nictation/"]', title: "a", link: "a", date: "" } } },
  { name: "雪球 行业讨论", tier: "T3", enabled: false, note: "0023 禁用：robots /k", config: { type: "playwright", listUrl: "https://xueqiu.com/k?q=%E7%94%B5%E7%BC%86", waitFor: "body", extractor: "() => Array.from(document.querySelectorAll('a')).slice(0,10).map(a => ({ title: a.textContent.trim(), url: a.href }))" } },
  { name: "知乎 电力话题", tier: "T3", enabled: false, config: { type: "playwright", listUrl: "https://www.zhihu.com/topic/19577810", waitFor: "body", extractor: "() => []" } },
  { name: "网易财经 能源", tier: "T3", enabled: true, config: { type: "html", listUrl: "https://money.163.com/", useRealUa: true, selectors: { item: ".channel_news li", title: ".news_title a", link: "a", date: ".news_time" } } },
];

interface AuditRow {
  name: string;
  tier: string;
  enabled: boolean;
  type: string;
  items: number | null;
  status: "ok" | "fail" | "skip" | "warn";
  error?: string;
  note?: string;
}

async function fetchSource(source: AuditSource): Promise<{ items: number; error?: string }> {
  const ctx = { sourceName: source.name, useRealUa: true };
  const cfg = source.config as SourceConfig & { useRealUa?: boolean };

  switch (cfg.type) {
    case "html":
      return { items: (await fetchHtml(cfg, ctx)).length };
    case "rss":
      return { items: (await fetchRss(cfg, ctx)).length };
    case "announcement":
      return { items: (await fetchAnnouncements(cfg, ctx)).length };
    case "playwright": {
      const pool = await createPlaywrightPool();
      try {
        return { items: (await fetchPlaywright(cfg, ctx, pool)).length };
      } finally {
        await pool.close();
      }
    }
    default:
      return { items: 0, error: `unsupported type ${(cfg as { type: string }).type}` };
  }
}

async function main(): Promise<void> {
  if (process.env.GOV_HTML_SMOKE_SKIP === "1") {
    console.log("GOV_HTML_SMOKE_SKIP=1 — 跳过网络探测");
    return;
  }

  const rows: AuditRow[] = [];
  const enabled = SOURCES.filter((s) => s.enabled);
  const disabled = SOURCES.filter((s) => !s.enabled);

  console.log(`\n=== 信源抓取审计（enabled=${enabled.length} / total=${SOURCES.length}）===\n`);

  for (const source of enabled) {
    const row: AuditRow = {
      name: source.name,
      tier: source.tier,
      enabled: true,
      type: source.config.type,
      items: null,
      status: "fail",
      note: source.note,
    };

    if (source.config.type === "rss" && source.config.url.includes("rsshub:1200")) {
      row.status = "skip";
      row.error = "需内网 RSSHub（worker 容器内 http://rsshub:1200）";
      rows.push(row);
      continue;
    }

    try {
      const result = await fetchSource(source);
      row.items = result.items;
      if (result.items >= 3) {
        row.status = "ok";
      } else if (result.items > 0) {
        row.status = "warn";
        row.error = `仅 ${result.items} 条（阈值 3）`;
      } else {
        row.status = "fail";
        row.error = result.error ?? "0 条";
      }
    } catch (error) {
      row.items = 0;
      row.status = "fail";
      const msg = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string })?.code;
      row.error = code ? `${code}: ${msg.slice(0, 120)}` : msg.slice(0, 120);
    }

    rows.push(row);
    const tag = row.status.toUpperCase().padEnd(4);
    console.log(`${tag}\t${row.tier}\t${row.type.padEnd(12)}\t${String(row.items ?? "-").padStart(3)}\t${row.name}${row.error ? `\t${row.error}` : ""}`);
  }

  const ok = rows.filter((r) => r.status === "ok").length;
  const warn = rows.filter((r) => r.status === "warn").length;
  const fail = rows.filter((r) => r.status === "fail").length;
  const skip = rows.filter((r) => r.status === "skip").length;

  console.log(`\n--- 汇总（仅 enabled 源）---`);
  console.log(`OK=${ok}  WARN=${warn}  FAIL=${fail}  SKIP=${skip}  / ${enabled.length}`);

  if (fail > 0) {
    console.log(`\n--- 失败清单 ---`);
    for (const r of rows.filter((x) => x.status === "fail")) {
      console.log(`  [${r.tier}] ${r.name} (${r.type}): ${r.error}`);
    }
  }

  console.log(`\n--- 已禁用源（${disabled.length}，设计如此）---`);
  for (const s of disabled) {
    console.log(`  [${s.tier}] ${s.name}${s.note ? ` — ${s.note}` : ""}`);
  }

  console.log(`\n提示：生产环境请运行 deploy/scripts/fetch-smoke-check.sh 查看 DB 实际 items 入库情况`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
