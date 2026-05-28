import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fetchHtml } from "../html";
import type { HtmlSourceConfig } from "../types";

const FIXTURES_DIR = join(__dirname, "fixtures", "gov-html");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

export interface GovHtmlSourceFixture {
  name: string;
  config: HtmlSourceConfig;
  fixture: string;
}

export const GOV_HTML_SOURCE_FIXTURES: GovHtmlSourceFixture[] = [
  {
    name: "ndrc",
    fixture: "ndrc.html",
    config: {
      type: "html",
      listUrl: "https://www.ndrc.gov.cn/xwdt/xwfb/",
      selectors: { item: "ul.u-list > li", title: "a", link: "a", date: "span" }
    }
  },
  {
    name: "miit",
    fixture: "miit.html",
    config: {
      type: "html",
      listUrl: "https://www.miit.gov.cn/xwdt/gxdt/index.html",
      selectors: { item: ".list ul li, .cata-list li", title: "a", link: "a", date: "span" }
    }
  },
  {
    name: "cec",
    fixture: "cec.html",
    config: {
      type: "html",
      listUrl: "https://www.cec.org.cn/yaowen/index.jhtml",
      selectors: { item: ".list-ul li, ul.list li, #list li", title: "a", link: "a", date: "span" }
    }
  },
  {
    name: "ceeia",
    fixture: "ceeia.html",
    config: {
      type: "html",
      listUrl: "http://www.ceeia.com/news/",
      selectors: { item: ".notice-list.tab-con.active p.text-of", title: "a", link: "a", date: "span" }
    }
  },
  {
    name: "cnesa",
    fixture: "cnesa.html",
    config: {
      type: "html",
      listUrl: "http://www.cnesa.org/index/news",
      selectors: { item: "article.et-item", title: "a", link: "a", date: "time" }
    }
  },
  {
    name: "cpnn",
    fixture: "cpnn.html",
    config: {
      type: "html",
      listUrl: "http://www.cpnn.com.cn/",
      selectors: { item: "ul.infoList > li", title: "a", link: "a", date: "span" }
    }
  },
  {
    name: "solarbe",
    fixture: "solarbe.html",
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
    name: "inen",
    fixture: "inen.html",
    config: {
      type: "html",
      listUrl: "https://www.in-en.com/news/",
      selectors: { item: "ul.infoList > li", title: ".listTxt h5 a", link: "a", date: "span" }
    }
  }
];

vi.mock("../http", () => ({
  fetchTextWithPolicy: vi.fn()
}));

vi.mock("../../lib/robots", () => ({
  assertRobotsAllowed: vi.fn().mockResolvedValue(undefined)
}));

import { fetchTextWithPolicy } from "../http";

const mockFetchText = vi.mocked(fetchTextWithPolicy);

describe("gov html sources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(GOV_HTML_SOURCE_FIXTURES)("$name returns at least 3 items with title and url", async ({ name, config, fixture }) => {
    mockFetchText.mockResolvedValueOnce(loadFixture(fixture));

    const items = await fetchHtml(config, { sourceName: name, useRealUa: true });

    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const item of items) {
      expect(item.title.trim().length).toBeGreaterThan(0);
      expect(item.url).toMatch(/^https?:\/\//);
    }
  });
});
