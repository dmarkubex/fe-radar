import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(__dirname, "../../migrations/0013_sources_rsshub_finance.sql");

describe("0013 RSSHub finance migration", () => {
  it("migrates exactly three finance sources to rss with rsshub absolute URLs", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("界面新闻 能源");
    expect(sql).toContain("第一财经 能源");
    expect(sql).toContain("36氪 新能源");
    expect(sql).toMatch(/fetcher_type = 'rss'/g);
    expect(sql.match(/http:\/\/rsshub:1200\//g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).not.toMatch(/SET\s+url\s*=\s*'http:\/\/rsshub:1200\//);
    expect(sql).not.toContain("rsshub-extract");
    expect(sql).not.toContain("${RSSHUB_BASE_URL}");
  });

  it("documents manual rollback for the three updates", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("Rollback (manual; top-level url unchanged)");
    expect(sql).toContain("jiemian.com/lists/55.html");
    expect(sql).toContain("yicai.com/news/energy");
    expect(sql).toContain("36kr.com/information/web_news");
  });
});
