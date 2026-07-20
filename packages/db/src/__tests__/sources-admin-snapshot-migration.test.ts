import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(__dirname, "../../migrations/0035_sources_admin_snapshot.sql");

describe("0035 sources admin snapshot migration", () => {
  it("adds the nullable admin snapshot column", () => {
    const migrationSql = readFileSync(migrationPath, "utf8");

    expect(migrationSql).toMatch(/ADD COLUMN IF NOT EXISTS admin_snapshot JSONB/i);
  });

  it("restores only explicitly snapshotted enabled and config values", () => {
    const migrationSql = readFileSync(migrationPath, "utf8");

    expect(migrationSql).toContain("WHERE admin_touched_at IS NOT NULL");
    expect(migrationSql).toContain("admin_snapshot ? 'enabled'");
    expect(migrationSql).toContain("admin_snapshot ? 'config'");
    expect(migrationSql).toContain("enabled IS DISTINCT FROM (admin_snapshot->>'enabled')::boolean");
    expect(migrationSql).toContain("config IS DISTINCT FROM (admin_snapshot->'config')");
  });
});
