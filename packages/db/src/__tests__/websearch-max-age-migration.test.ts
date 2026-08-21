import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(__dirname, "../../migrations/0069_websearch_max_age.sql"),
  "utf8"
);

describe("0069 websearch maxAgeHours", () => {
  it("fills source 148 gate0.maxAgeHours only when missing", () => {
    expect(sql).toContain("WHERE id = 148");
    expect(sql).toContain("fetcher_type = 'websearch'");
    expect(sql).toContain("'{gate0}'");
    expect(sql).toContain("COALESCE(config->'gate0', '{}'::jsonb)");
    expect(sql).toContain("'{gate0,maxAgeHours}'");
    expect(sql).toContain("'48'::jsonb");
    expect(sql).toContain("COALESCE(config #> '{gate0,maxAgeHours}', '48'::jsonb)");
    expect(sql).not.toMatch(/admin_touched_at IS NULL/);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+sources/i);
  });

  it("does not rewrite T-UP sweep config", () => {
    expect(sql).not.toContain("{sweep}");
    expect(sql).not.toContain("maxPerRun");
  });
});
