import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(__dirname, "../../migrations/0012_announcement_fetcher_type.sql");

describe("0012 announcement fetcher type migration", () => {
  it("adds announcement to the sources fetcher type CHECK", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("sources_fetcher_type_check");
    expect(sql).toContain("'announcement'");
    expect(sql).toMatch(/CHECK\s*\(\s*fetcher_type\s+IN\s*\('rss', 'html', 'playwright', 'quotes', 'announcement'\)\s*\)/);
  });

  it("documents a reversible down migration that preserves quotes", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("ROLLBACK SQL");
    expect(sql).toMatch(/CHECK\s*\(\s*fetcher_type\s+IN\s*\('rss', 'html', 'playwright', 'quotes'\)\s*\)/);
    expect(sql).not.toMatch(/CHECK\s*\(\s*fetcher_type\s+IN\s*\('rss', 'html', 'playwright'\)\s*\)/);
  });
});
