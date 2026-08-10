import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(__dirname, "../../migrations/0059_disable_legacy_viewer_credential.sql");

describe("0059 disable legacy viewer credential migration (复核 F1)", () => {
  const sql = readFileSync(migrationPath, "utf8");

  it("disables the known viewer/viewer-password row and bumps token_version", () => {
    expect(sql).toContain("UPDATE users");
    expect(sql).toContain("username = 'viewer'");
    expect(sql).toContain("role = 'viewer'");
    expect(sql).toContain("disabled_at");
    expect(sql).toContain("token_version = token_version + 1");
  });

  it("scopes to non-dingtalk local accounts only (does not touch admin or SSO users)", () => {
    expect(sql).toContain("dingtalk_id IS NULL");
  });

  it("documents a manual rollback", () => {
    expect(sql).toContain("ROLLBACK");
  });
});
