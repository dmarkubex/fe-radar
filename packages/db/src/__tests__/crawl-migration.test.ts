import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(__dirname, "../../migrations/0020_crawl_fetcher_type_and_c1_risk_source.sql");
const backfillMigrationPath = resolve(__dirname, "../../migrations/0026_ensure_crawl_source_backfill.sql");
const sourceSeedMigrationPaths = [
  resolve(__dirname, "../../migrations/0011_sources_seed_v2.sql"),
  resolve(__dirname, "../../migrations/0013_announcement_sources_seed.sql"),
  resolve(__dirname, "../../migrations/0014_sources_seed_v3.sql"),
  resolve(__dirname, "../../migrations/0018_litigation_sources_seed.sql"),
  resolve(__dirname, "../../migrations/0020_crawl_fetcher_type_and_c1_risk_source.sql")
];
const titleKeywordBackfillPath = resolve(__dirname, "../../migrations/0021_litigation_title_keywords_backfill.sql");

describe("0020 crawl fetcher type migration", () => {
  it("adds crawl to the sources fetcher type CHECK", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("sources_fetcher_type_check");
    expect(sql).toContain("'crawl'");
    expect(sql).toMatch(/CHECK\s*\(\s*fetcher_type\s+IN\s*\('rss', 'html', 'playwright', 'quotes', 'announcement', 'crawl'\)\s*\)/);
  });

  it("seeds Firecrawl C1 risk source disabled by default", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("Firecrawl-C1风险检索");
    expect(sql).toContain("风险检索");
    expect(sql).toContain("false)");
  });

  it("stores C1 risk search keywords in source config", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain('"entityKeywords"');
    expect(sql).toContain('"riskKeywords"');
    expect(sql).toContain('"远东控股"');
    expect(sql).toContain('"被执行"');
  });

  it("does not overwrite existing source rows on seed conflicts", () => {
    for (const path of sourceSeedMigrationPaths) {
      const sql = readFileSync(path, "utf8");

      expect(sql).toMatch(/ON CONFLICT \(url\) DO NOTHING/);
      expect(sql).not.toMatch(/ON CONFLICT \(url\) DO UPDATE/);
    }
  });

  it("0026 backfill migration is idempotent and enables the crawl source", () => {
    const sql = readFileSync(backfillMigrationPath, "utf8");

    expect(sql).toContain("Firecrawl-C1风险检索");
    expect(sql).toContain("ON CONFLICT (url) DO NOTHING");
    expect(sql).toMatch(/SET enabled\s*=\s*true/);
  });

  it("backfills litigation title keywords only when admin has not configured them", () => {
    const sql = readFileSync(titleKeywordBackfillPath, "utf8");

    expect(sql).toContain("'titleKeywords'");
    expect(sql).toContain("config->'titleKeywords' IS NULL");
  });
});
