import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(__dirname, "../../migrations/0061_legacy_viewer_credential_purge.sql");

describe("0061 legacy viewer credential purge (S4)", () => {
  const sql = readFileSync(migrationPath, "utf8");

  it("clears password_hash for DingTalk-bound viewer rows and bumps token_version", () => {
    expect(sql).toContain("password_hash = NULL");
    expect(sql).toContain("token_version = token_version + 1");
    expect(sql).toContain("dingtalk_id IS NOT NULL");
    expect(sql).toContain("password_hash IS NOT NULL");
  });

  it("does not disable DingTalk-bound viewers when purging password", () => {
    // Branch A (first UPDATE) must not set disabled_at — only password_hash + token_version.
    // Use BEGIN… second UPDATE marker so ROLLBACK 注释里的 "-- B:" 不会误匹配。
    const beginAt = sql.indexOf("BEGIN;");
    const secondUpdate = sql.indexOf("UPDATE users", sql.indexOf("UPDATE users", beginAt) + 1);
    const branchA = sql.slice(beginAt, secondUpdate);
    expect(branchA).toContain("password_hash = NULL");
    expect(branchA).toContain("dingtalk_id IS NOT NULL");
    expect(branchA).not.toMatch(/disabled_at\s*=/);
  });

  it("disables still-active non-DingTalk local viewers (0059 semantics)", () => {
    expect(sql).toContain("dingtalk_id IS NULL");
    expect(sql).toContain("disabled_at IS NULL");
    expect(sql).toContain("disabled_at = COALESCE(disabled_at, NOW())");
  });

  it("scopes both branches to the known username=viewer role=viewer row", () => {
    expect(sql).toContain("username = 'viewer'");
    expect(sql).toContain("role = 'viewer'");
  });

  it("is idempotent via WHERE guards (no unconditional bump on re-run)", () => {
    expect(sql).toContain("password_hash IS NOT NULL");
    expect(sql).toContain("disabled_at IS NULL");
  });

  it("documents a manual rollback", () => {
    expect(sql).toContain("ROLLBACK");
  });

  it("has balanced transaction boundaries", () => {
    expect((sql.match(/\bBEGIN\b/g) ?? []).length).toBe(1);
    expect((sql.match(/\bCOMMIT\b/g) ?? []).length).toBe(1);
  });
});
