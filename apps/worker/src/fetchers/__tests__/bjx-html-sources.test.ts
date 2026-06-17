import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fetchHtml } from "../html";
import type { HtmlSourceConfig } from "../types";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

const BJX_SOURCES: Array<{ name: string; config: HtmlSourceConfig }> = [
  {
    name: "北极星储能网",
    config: {
      type: "html",
      listUrl: "https://chuneng.bjx.com.cn/",
      selectors: { item: ".cc-ul-dot li", title: "a", link: "a", date: "" },
    },
  },
  {
    name: "北极星电力新闻网",
    config: {
      type: "html",
      listUrl: "https://www.bjx.com.cn/",
      selectors: {
        item: '.cc-ul-dot li a[href*="news.bjx.com.cn/html"]',
        title: "a",
        link: "a",
        date: "",
      },
    },
  },
];

describe("bjx html sources", () => {
  for (const source of BJX_SOURCES) {
    it(`extracts items from ${source.name} fixture`, async () => {
      const fetchImpl = async (url: string) =>
        url.endsWith("/robots.txt")
          ? new Response("")
          : new Response(loadFixture(`${source.name === "北极星储能网" ? "chuneng" : "bjx-www"}.html`));

      const items = await fetchHtml(source.config, { sourceName: source.name, useRealUa: true }, fetchImpl as typeof fetch);

      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(items[0]?.url).toMatch(/bjx\.com\.cn/);
      expect(items[0]?.title.length).toBeGreaterThan(4);
    });
  }

  it("reports WAF challenge when page is blocked", async () => {
    const fetchImpl = async (url: string) =>
      url.endsWith("/robots.txt")
        ? new Response("")
        : new Response('<html><meta name="aliyun_waf_aa"></html>');

    await expect(
      fetchHtml(
        {
          type: "html",
          listUrl: "https://news.bjx.com.cn/",
          selectors: { item: ".cc-ul-dot li", title: "a", link: "a", date: "" },
        },
        { sourceName: "blocked", useRealUa: true },
        fetchImpl as typeof fetch
      )
    ).rejects.toMatchObject({ code: "FETCH_WAF_CHALLENGE" });
  });
});
