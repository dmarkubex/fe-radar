#!/usr/bin/env tsx
import { fetchHtml } from "../src/fetchers/html.js";
import type { HtmlSourceConfig } from "../src/fetchers/types.js";

interface GovHtmlSmokeSource {
  name: string;
  enabled: boolean;
  config: HtmlSourceConfig;
}

const GOV_HTML_SMOKE_SOURCES: GovHtmlSmokeSource[] = [
  {
    name: "国家发改委",
    enabled: true,
    config: {
      type: "html",
      listUrl: "https://www.ndrc.gov.cn/xwdt/xwfb/",
      selectors: { item: "ul.u-list > li", title: "a", link: "a", date: "span" }
    }
  },
  {
    name: "工信部",
    enabled: true,
    config: {
      type: "html",
      listUrl: "https://www.miit.gov.cn/xwdt/gxdt/index.html",
      selectors: { item: ".list ul li, .cata-list li", title: "a", link: "a", date: "span" }
    }
  },
  {
    name: "中电联",
    enabled: true,
    config: {
      type: "html",
      listUrl: "https://www.cec.org.cn/yaowen/index.jhtml",
      selectors: { item: ".list-ul li, ul.list li, #list li", title: "a", link: "a", date: "span" }
    }
  },
  {
    name: "中国电器工业协会",
    enabled: true,
    config: {
      type: "html",
      listUrl: "http://www.ceeia.com/news/",
      selectors: { item: ".notice-list.tab-con.active p.text-of", title: "a", link: "a", date: "span" }
    }
  },
  {
    name: "中关村储能产业技术联盟 CNESA",
    enabled: true,
    config: {
      type: "html",
      listUrl: "http://www.cnesa.org/index/news",
      selectors: { item: "article.et-item", title: "a", link: "a", date: "time" }
    }
  },
  {
    name: "中国电力新闻网",
    enabled: true,
    config: {
      type: "html",
      listUrl: "http://www.cpnn.com.cn/",
      selectors: { item: "ul.infoList > li", title: "a", link: "a", date: "span" }
    }
  },
  {
    name: "索比光伏网",
    enabled: true,
    config: {
      type: "html",
      listUrl: "https://www.solarbe.com/news/",
      selectors: {
        item: '.xNews_left a[href*="news.solarbe.com/20"]',
        title: "a",
        link: "a",
        date: "span"
      }
    }
  },
  {
    name: "国际能源网",
    enabled: true,
    config: {
      type: "html",
      listUrl: "https://www.in-en.com/news/",
      selectors: { item: "ul.infoList > li", title: ".listTxt h5 a", link: "a", date: "span" }
    }
  }
];

interface SmokeRow {
  name: string;
  enabled: boolean;
  httpStatus: string;
  itemCount: string;
  ok: boolean;
}

async function probeHttpStatus(listUrl: string): Promise<number | null> {
  try {
    const response = await fetch(listUrl, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
      },
      redirect: "follow"
    });
    return response.status;
  } catch {
    return null;
  }
}

async function runSmoke(): Promise<void> {
  const rows: SmokeRow[] = [];
  let failed = false;

  for (const source of GOV_HTML_SMOKE_SOURCES) {
    if (!source.enabled) {
      rows.push({ name: source.name, enabled: false, httpStatus: "n/a", itemCount: "n/a", ok: true });
      continue;
    }

    const status = await probeHttpStatus(source.config.listUrl);
    const httpStatus = status === null ? "error" : String(status);
    const httpOk = status !== null && status >= 200 && status < 300;

    let itemCount = 0;
    try {
      const items = await fetchHtml(source.config, { sourceName: source.name, useRealUa: true });
      itemCount = items.length;
    } catch {
      itemCount = 0;
    }

    const ok = httpOk && itemCount >= 3;
    if (!ok) {
      failed = true;
    }

    rows.push({
      name: source.name,
      enabled: true,
      httpStatus,
      itemCount: String(itemCount),
      ok
    });
  }

  console.log("| Source | Enabled | HTTP | Items | OK |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const row of rows) {
    console.log(`| ${row.name} | ${row.enabled ? "yes" : "no"} | ${row.httpStatus} | ${row.itemCount} | ${row.ok ? "yes" : "no"} |`);
  }

  if (failed) {
    process.exit(1);
  }
}

async function main(): Promise<void> {
  if (process.env.GOV_HTML_SMOKE_SKIP === "1") {
    console.log("GOV_HTML_SMOKE_SKIP=1 — skipping live network smoke checks");
    return;
  }

  await runSmoke();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
