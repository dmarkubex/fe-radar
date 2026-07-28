import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  __dirname,
  "../../migrations/0041_disable_unfetchable_cwea.sql"
);
const sql = readFileSync(migrationPath, "utf8");

describe("0041 CWEA soft-disable migration", () => {
  it("soft-disables only the source still incompatible with the HTML fetcher", () => {
    expect(sql).toContain("WHERE url = 'http://www.cwea.org.cn/news.html'");
    expect(sql).toContain("enabled = false");
    expect(sql).toContain("news_lastest.js");
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+sources\b/i);
  });

  it("does not undo the live CPIA and escn URL repairs from 0023", () => {
    expect(sql).not.toContain("中国光伏行业协会 CPIA");
    expect(sql).not.toContain("储能网 escn");
  });

  it("force-disables even admin-touched rows as a documented safety exception", () => {
    expect(sql).not.toContain("admin_touched_at IS NULL");
    expect(sql).not.toContain(
      "NOT COALESCE(admin_snapshot ? 'enabled', false)"
    );
    expect(sql).toContain("0041 CWEA safety-disable result");
    expect(sql).toContain("admin_touched_at IS NOT NULL");
    expect(sql).toContain("Deliberate narrow exception");
  });

  it("preserves the real last-failure timestamp", () => {
    expect(sql).not.toContain("last_error_at = NULL");
    expect(sql).not.toContain("last_error_at = now()");
  });
});
