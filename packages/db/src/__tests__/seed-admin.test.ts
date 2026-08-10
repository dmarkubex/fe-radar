/**
 * seed-admin — upsertAdmin token_version 条件递增（T15e）。
 *
 * 背景：Portainer 把 migrate 与 seed:admin 绑死；旧逻辑每次 seed 无条件
 * token_version+1，即使 SEED_ADMIN_PASSWORD 未变也会踢空 admin 会话。
 *
 * 修法：先 SELECT 存量 password_hash，应用层 bcrypt.compare 判密码是否真变；
 * 仅 isChanged 时 SQL 片段用 users.token_version + 1，否则保持 users.token_version。
 * 禁止 SQL 字面量比较 bcrypt hash（每次 salt 不同，恒假——V-1 已踩坑）。
 *
 * 测试策略：假 sql 标签函数（同 purge-legacy-viewer-branch-b），
 * 检查真实拼出来的 SQL 文本；不连真实 DB。
 * 回代验算用真实 bcrypt hash。
 */
import bcrypt from "bcryptjs";
import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { upsertAdmin, type SeedUser } from "../../scripts/seed-admin";

const ADMIN: SeedUser = {
  username: "admin",
  password: "seed-admin-password",
  name: "系统管理员",
  dept: "产业情报",
  role: "admin",
};

/** postgres 风格 pending：带 strings/args，可 await，嵌套片段可被外层识别。 */
type FakePending = Promise<unknown> & {
  strings: readonly string[];
  args: unknown[];
};

function reconstructSql(strings: readonly string[], args: unknown[]): string {
  let out = "";
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < args.length) {
      const a = args[i] as { strings?: readonly string[]; args?: unknown[] } | unknown;
      if (a && typeof a === "object" && Array.isArray((a as FakePending).strings)) {
        const frag = a as FakePending;
        out += reconstructSql(frag.strings, frag.args ?? []);
      } else {
        out += `$${i + 1}`;
      }
    }
  }
  return out;
}

/**
 * 假 sql 标签：SELECT password_hash 返回给定行；INSERT/UPDATE 记入 calls。
 * 嵌套片段（token_version 表达式）返回带 strings 的 thenable，与 postgres v3 一致。
 */
function createFakeSql(selectRows: Array<{ password_hash: string | null }>) {
  const calls: Array<{ strings: readonly string[]; args: unknown[] }> = [];

  const fakeSql = ((strings: TemplateStringsArray, ...args: unknown[]) => {
    const pending = Promise.resolve(
      /^\s*SELECT/i.test(strings[0] ?? "") ? selectRows : [],
    ) as FakePending;
    pending.strings = strings;
    pending.args = args;

    const joined = strings.join("");
    if (/\b(SELECT|INSERT)\b/i.test(joined)) {
      calls.push({ strings: [...strings], args });
    }
    return pending;
  }) as unknown as postgres.Sql;

  return { sql: fakeSql, calls };
}

function findUpsertSql(calls: Array<{ strings: readonly string[]; args: unknown[] }>): string {
  const upsert = calls.find((c) => /\bINSERT\b/i.test(c.strings.join("")));
  if (!upsert) {
    throw new Error("expected INSERT upsert call");
  }
  return reconstructSql(upsert.strings, upsert.args);
}

describe("upsertAdmin — token_version conditional bump (T15e)", () => {
  it("场景 A: 首次创建（无存量用户）→ isChanged，SQL 用 token_version + 1（DEFAULT 0 起算）", async () => {
    // schema: token_version INTEGER NOT NULL DEFAULT 0（0057）
    // 无存量行 → 视为变化；INSERT 路径用 DEFAULT 0，ON CONFLICT 片段带 +1
    const { sql, calls } = createFakeSql([]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await upsertAdmin(sql, ADMIN);

    log.mockRestore();
    expect(calls.some((c) => /\bSELECT\b/i.test(c.strings.join("")))).toBe(true);
    const upsertSql = findUpsertSql(calls);
    expect(upsertSql).toMatch(/token_version\s*=\s*users\.token_version\s*\+\s*1/);
  });

  it("场景 B: 存量用户 + 相同密码 → token_version 保持不变（本任务核心修复）", async () => {
    const existingHash = await bcrypt.hash(ADMIN.password, 12);
    const { sql, calls } = createFakeSql([{ password_hash: existingHash }]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await upsertAdmin(sql, ADMIN);

    log.mockRestore();
    const upsertSql = findUpsertSql(calls);

    // 旧逻辑无条件 `users.token_version + 1`——该断言在修复前会红：
    //   expect(oldSql).toMatch(/token_version\s*=\s*users\.token_version\b(?!\s*\+)/) → fail
    // 修复后：密码未变 → 保持 users.token_version，无 +1
    expect(upsertSql).toMatch(/token_version\s*=\s*users\.token_version\b/);
    expect(upsertSql).not.toMatch(/token_version\s*=\s*users\.token_version\s*\+\s*1/);
  });

  it("场景 C: 存量用户 + 密码真变 → token_version +1（T-SEC-06 回归）", async () => {
    const existingHash = await bcrypt.hash("old-different-password", 12);
    const { sql, calls } = createFakeSql([{ password_hash: existingHash }]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await upsertAdmin(sql, ADMIN);

    log.mockRestore();
    const upsertSql = findUpsertSql(calls);
    expect(upsertSql).toMatch(/token_version\s*=\s*users\.token_version\s*\+\s*1/);
  });

  it("name/dept/role 始终出现在 DO UPDATE SET（无条件更新）", async () => {
    const existingHash = await bcrypt.hash(ADMIN.password, 12);
    const { sql, calls } = createFakeSql([{ password_hash: existingHash }]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await upsertAdmin(sql, {
      ...ADMIN,
      name: "新名称",
      dept: "新部门",
    });

    log.mockRestore();
    const upsertSql = findUpsertSql(calls);
    expect(upsertSql).toMatch(/name\s*=\s*EXCLUDED\.name/);
    expect(upsertSql).toMatch(/dept\s*=\s*EXCLUDED\.dept/);
    expect(upsertSql).toMatch(/role\s*=\s*EXCLUDED\.role/);
  });

  it("存量 password_hash 为空/缺失 → 视为变化并 +1", async () => {
    const { sql, calls } = createFakeSql([{ password_hash: null }]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await upsertAdmin(sql, ADMIN);

    log.mockRestore();
    const upsertSql = findUpsertSql(calls);
    expect(upsertSql).toMatch(/token_version\s*=\s*users\.token_version\s*\+\s*1/);
  });
});

describe("回代验算 — 旧逻辑无条件 +1 在场景 B 下必红", () => {
  it("旧 SQL 片段恒含 +1，无法满足「密码未变保持 token_version」断言", () => {
    // 修复前 seed-admin.ts 硬编码：
    const oldUpsertFragment = "token_version = users.token_version + 1";
    // 场景 B 验收断言（与上面场景 B 一致）在旧片段上失败：
    const wouldPassKeep =
      /token_version\s*=\s*users\.token_version\b/.test(oldUpsertFragment) &&
      !/token_version\s*=\s*users\.token_version\s*\+\s*1/.test(oldUpsertFragment);
    expect(wouldPassKeep).toBe(false);

    // 修复后片段（密码未变）可通过：
    const newKeepFragment = "token_version = users.token_version";
    const nowPasses =
      /token_version\s*=\s*users\.token_version\b/.test(newKeepFragment) &&
      !/token_version\s*=\s*users\.token_version\s*\+\s*1/.test(newKeepFragment);
    expect(nowPasses).toBe(true);
  });
});

describe("回代验算 — 真实 bcrypt.compare（禁止 SQL 字面量比 hash）", () => {
  it("同一明文两次 hash 字符串不相等，但 compare 均为 true", async () => {
    const plain = ADMIN.password;
    const h1 = await bcrypt.hash(plain, 12);
    const h2 = await bcrypt.hash(plain, 12);
    // V-1 坑：SQL `password_hash = ${newHash}` 恒假
    expect(h1).not.toBe(h2);
    expect(await bcrypt.compare(plain, h1)).toBe(true);
    expect(await bcrypt.compare(plain, h2)).toBe(true);
  });

  it("明文不同 → compare false → 应走 +1 分支（场景 C 数据）", async () => {
    const stored = await bcrypt.hash("previous-password", 12);
    expect(await bcrypt.compare(ADMIN.password, stored)).toBe(false);
  });
});
