import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { splitStatements } from "../../scripts/migrate";

const migrationPath = resolve(
  __dirname,
  "../../migrations/0040_cnesa_selector_refresh.sql"
);
const sql = readFileSync(migrationPath, "utf8");

describe("0040 CNESA selector refresh migration", () => {
  it("updates the existing source instead of inserting a duplicate", () => {
    expect(sql).toContain("UPDATE sources");
    expect(sql).not.toContain("INSERT INTO sources");
    expect(sql).toContain("url = 'http://www.cnesa.org/index/news'");
  });

  it("uses selectors that resolve a titled article link and excerpt", () => {
    expect(sql).toContain('"item": "article.et-item"');
    expect(sql).toContain('"title": ".post-title a"');
    expect(sql).toContain('"link": ".post-title a"');
    expect(sql).toContain('"content": ".post-excerpt"');
  });

  it("preserves admin config but force-disables even admin-touched rows", () => {
    expect(sql).toContain("fail_count = 0");
    expect(sql).toContain("NOT COALESCE(admin_snapshot ? 'config', false)");
    expect(sql).not.toContain(
      "NOT COALESCE(admin_snapshot ? 'enabled', false)"
    );
    expect(sql).not.toContain("admin_touched_at IS NULL");
    expect(sql).toMatch(
      /UPDATE sources\s+SET enabled = false,[\s\S]*WHERE url IN \([\s\S]*http:\/\/www\.cnesa\.org\/index\/news[\s\S]*https:\/\/www\.cnesa\.org\/index\/news/
    );
    expect(sql).toContain("Deliberate narrow exception");
    expect(sql).toContain("admin-set enabled=true");
  });

  it("preserves the real last-failure timestamp", () => {
    expect(sql).not.toContain("last_error_at = NULL");
    expect(sql).not.toContain("last_error_at = now()");
  });

  it("stays disabled because the list page has no per-item date element", () => {
    expect(sql).toContain("enabled = false");
    expect(sql).not.toContain("enabled = true");
    expect(sql).toContain('"date": ".union-time"');
    expect(sql).not.toContain('"date": ".post-date"');
    expect(sql).toMatch(/last_error = '[^']+'/);
  });

  it("reports disabled and admin-touched row counts in a runnable DO block", () => {
    const statements = splitStatements(sql);
    const notice = statements.find((statement) =>
      statement.includes("0040 CNESA safety-disable result")
    );
    expect(notice).toContain("RAISE NOTICE");
    expect(notice).toContain("admin_touched_at IS NOT NULL");
  });
});
