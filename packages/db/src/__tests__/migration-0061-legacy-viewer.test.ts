/**
 * 0061 legacy viewer credential purge — SQL 源文件契约测试（非执行测试）。
 *
 * B-3 fix：分支 B 已从迁移中移除（SQL 无法安全比对 bcrypt hash），
 * 改为应用层脚本 purge-legacy-viewer-branch-b.ts。本测试断言：
 *   - 可执行体内只有分支 A（清 hash + bump token_version），不再有禁用逻辑
 *   - 分支 A 保持 role-agnostic（覆盖提权 admin 回归）
 *   - 迁移注释引用了脚本路径
 *
 * 能力上限（诚实声明）：
 * - 本环境无 DATABASE_URL / 无 Docker Postgres，无法对真实库执行迁移。
 * - 本文件只断言迁移 SQL 文本中的 WHERE 分流与幂等守卫，**不**声称验证了
 *   迁移在 Postgres 上的实际行变更或约束交互。
 * - 分支 B 的行为验证见 purge-legacy-viewer-branch-b.test.ts。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(__dirname, "../../migrations/0061_legacy_viewer_credential_purge.sql");

/** Extract the executable body between BEGIN; and COMMIT; (excludes ROLLBACK comments). */
function executableBody(sql: string): string {
  const beginAt = sql.indexOf("BEGIN;");
  const commitAt = sql.indexOf("COMMIT;");
  expect(beginAt).toBeGreaterThanOrEqual(0);
  expect(commitAt).toBeGreaterThan(beginAt);
  return sql.slice(beginAt, commitAt);
}

describe("0061 legacy viewer credential purge (S4 / T3 A-3 / B-3)", () => {
  const sql = readFileSync(migrationPath, "utf8");
  const body = executableBody(sql);

  it("branch A: clears password for any username=viewer with dingtalk (role-agnostic, incl. elevated admin)", () => {
    // A-3: elevated admin/editor still matches — must NOT filter role = 'viewer'
    expect(body).toContain("username = 'viewer'");
    expect(body).toContain("dingtalk_id IS NOT NULL");
    expect(body).toContain("password_hash IS NOT NULL");
    expect(body).toContain("password_hash = NULL");
    expect(body).toContain("token_version = token_version + 1");
    expect(body).not.toMatch(/role\s*=\s*'viewer'/);
    // Does not disable DingTalk-bound accounts
    expect(body).not.toMatch(/disabled_at\s*=/);
  });

  it("branch B removed from migration: executable body contains no disable logic (B-3 fix)", () => {
    // The dangerous UPDATE ... SET disabled_at = COALESCE(...) WHERE ... dingtalk_id IS NULL
    // must no longer be in the auto-migration.
    expect(body).not.toContain("disabled_at IS NULL");
    expect(body).not.toMatch(/disabled_at\s*=\s*COALESCE/);
    expect(body).not.toContain("dingtalk_id IS NULL");
  });

  it("executable body has exactly one UPDATE (branch A only)", () => {
    const updateCount = (body.match(/UPDATE users/g) ?? []).length;
    expect(updateCount).toBe(1);
  });

  it("executable body never filters on role (covers elevated-admin regression)", () => {
    expect(body).not.toMatch(/role\s*=\s*'viewer'/);
    expect(body).toContain("username = 'viewer'");
  });

  it("references the branch B script path in comments", () => {
    expect(sql).toContain("purge-legacy-viewer-branch-b.ts");
  });

  it("documents a manual rollback", () => {
    expect(sql).toContain("ROLLBACK");
  });

  it("has balanced transaction boundaries", () => {
    expect((sql.match(/\bBEGIN\b/g) ?? []).length).toBe(1);
    expect((sql.match(/\bCOMMIT\b/g) ?? []).length).toBe(1);
  });
});
