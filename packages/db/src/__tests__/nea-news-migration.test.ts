import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  __dirname,
  "../../migrations/0039_nea_news_json_adapter.sql"
);
const sql = readFileSync(migrationPath, "utf8");

describe("0039 National Energy Administration JSON adapter migration", () => {
  it("updates the existing legacy source to the allowlisted JSON adapter", () => {
    expect(sql).toContain("'https://www.nea.gov.cn/xwzx/zyxw.htm'");
    expect(sql).toContain("'https://www.nea.gov.cn/xwzx/index.htm'");
    expect(sql).toContain("fetcher_type = 'announcement'");
    expect(sql).toContain('"adapter": "nea-news"');
    expect(sql).toContain("ds_8839d76f7cb542ca8cbaab7122cc9b83.json");
    expect(sql).not.toContain("INSERT INTO sources");
  });

  it("keeps the source disabled until deployment-network smoke succeeds", () => {
    expect(sql).toContain("enabled = false");
    expect(sql).toContain("待部署网络 smoke >=3 条后启用");
  });

  it("preserves admin config but force-disables even admin-touched rows", () => {
    expect(sql).toContain("NOT COALESCE(admin_snapshot ? 'config', false)");
    expect(sql).not.toContain("admin_touched_at IS NULL");
    expect(sql).not.toContain(
      "NOT COALESCE(admin_snapshot ? 'enabled', false)"
    );
    expect(sql).toContain("0039 NEA safety-disable result");
    expect(sql).toContain("admin_touched_at IS NOT NULL");
    expect(sql).toContain("Deliberate narrow exception");
  });

  it("preserves the real last-failure timestamp", () => {
    expect(sql).not.toContain("last_error_at = NULL");
    expect(sql).not.toContain("last_error_at = now()");
  });
});
