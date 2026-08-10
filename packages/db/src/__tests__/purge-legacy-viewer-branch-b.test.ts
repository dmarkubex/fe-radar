/**
 * purge-legacy-viewer-branch-b — 脚本决策逻辑测试。
 *
 * B-3 核心行为：只禁用 password_hash 确实等于已知泄漏口令的行；
 * 口令已被合法轮换的行跳过 + 打印提示，不禁用。
 *
 * 测试策略：注入 mock compare 函数，不依赖真实 DB。
 * 回代验算见末尾 "back-substitution with real bcrypt" describe 块（真实 hash 代入）。
 */
import bcrypt from "bcryptjs";
import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  LEAKED_VIEWER_PASSWORD,
  decidePurge,
  purgeBranchB,
  fetchCandidates,
  disableCandidate,
} from "../../scripts/purge-legacy-viewer-branch-b";
import type { CandidateRow } from "../../scripts/purge-legacy-viewer-branch-b";

describe("decidePurge", () => {
  it("returns shouldDisable=true when compare confirms the leaked password", async () => {
    const row: CandidateRow = { id: 1, username: "viewer", passwordHash: "$2a$12$somehash" };
    const compare = vi.fn().mockResolvedValue(true);

    const decision = await decidePurge(row, compare);

    expect(decision.shouldDisable).toBe(true);
    expect(compare).toHaveBeenCalledWith(LEAKED_VIEWER_PASSWORD, "$2a$12$somehash");
  });

  it("returns shouldDisable=false when password was rotated (compare returns false)", async () => {
    // This is the core fix: a rotated password must NOT be disabled.
    const row: CandidateRow = { id: 2, username: "viewer", passwordHash: "$2a$12$rotatedhash" };
    const compare = vi.fn().mockResolvedValue(false);

    const decision = await decidePurge(row, compare);

    expect(decision.shouldDisable).toBe(false);
    expect(compare).toHaveBeenCalledWith(LEAKED_VIEWER_PASSWORD, "$2a$12$rotatedhash");
  });

  it("returns shouldDisable=false when passwordHash is null (nothing to compare)", async () => {
    const row: CandidateRow = { id: 3, username: "viewer", passwordHash: null };
    const compare = vi.fn().mockResolvedValue(true); // would return true but never called

    const decision = await decidePurge(row, compare);

    expect(decision.shouldDisable).toBe(false);
    expect(compare).not.toHaveBeenCalled();
  });

  it("uses the known leaked password plaintext", () => {
    expect(LEAKED_VIEWER_PASSWORD).toBe("viewer-password");
  });
});

describe("purgeBranchB — end-to-end with mock compare", () => {
  it("disables leaked rows and skips rotated rows, with correct log output", async () => {
    const candidates: CandidateRow[] = [
      { id: 1, username: "viewer", passwordHash: "$2a$12$leaked" },
      { id: 2, username: "viewer", passwordHash: "$2a$12$rotated" },
    ];
    // id=1 matches leaked, id=2 does not
    const compare = vi.fn().mockImplementation(async (_plain: string, hash: string) => {
      return hash === "$2a$12$leaked";
    });
    const disabledIds: number[] = [];
    const onDisable = vi.fn().mockImplementation(async (row: CandidateRow) => {
      disabledIds.push(row.id);
      return { affected: 1 };
    });
    const logs: string[] = [];

    const result = await purgeBranchB(candidates, compare, onDisable, (line) => logs.push(line));

    // Exactly one row disabled (the leaked one)
    expect(result.disabled).toBe(1);
    expect(result.skipped).toBe(1);
    expect(disabledIds).toEqual([1]);

    // The rotated row was NOT disabled
    expect(onDisable).toHaveBeenCalledTimes(1);
    expect(onDisable).toHaveBeenCalledWith(candidates[0]);

    // Log for disabled row
    expect(logs).toContainEqual(
      expect.stringMatching(/disabled user id=1.*matched leaked default credential/),
    );
    // Log for skipped row — must NOT contain password or hash
    const skipLog = logs.find((l) => l.includes("SKIP") && l.includes("id=2"));
    expect(skipLog).toBeDefined();
    expect(skipLog).toContain("manual confirmation");
    expect(skipLog).not.toContain("$2a$12$rotated");
  });

  it("skips all rows when all passwords are rotated (no disables)", async () => {
    const candidates: CandidateRow[] = [
      { id: 10, username: "viewer", passwordHash: "$2a$12$strong1" },
      { id: 11, username: "viewer", passwordHash: "$2a$12$strong2" },
    ];
    const compare = vi.fn().mockResolvedValue(false); // none match
    const onDisable = vi.fn();
    const logs: string[] = [];

    const result = await purgeBranchB(candidates, compare, onDisable, (line) => logs.push(line));

    expect(result.disabled).toBe(0);
    expect(result.skipped).toBe(2);
    expect(onDisable).not.toHaveBeenCalled();
    expect(logs.filter((l) => l.startsWith("SKIP"))).toHaveLength(2);
  });

  it("disables all rows when all match the leaked password", async () => {
    const candidates: CandidateRow[] = [
      { id: 20, username: "viewer", passwordHash: "$2a$12$h1" },
      { id: 21, username: "viewer", passwordHash: "$2a$12$h2" },
    ];
    const compare = vi.fn().mockResolvedValue(true); // all match
    const onDisable = vi.fn().mockResolvedValue({ affected: 1 });
    const logs: string[] = [];

    const result = await purgeBranchB(candidates, compare, onDisable, (line) => logs.push(line));

    expect(result.disabled).toBe(2);
    expect(result.skipped).toBe(0);
    expect(onDisable).toHaveBeenCalledTimes(2);
    expect(logs.filter((l) => l.startsWith("disabled"))).toHaveLength(2);
  });

  it("handles empty candidate list", async () => {
    const compare = vi.fn();
    const onDisable = vi.fn();

    const result = await purgeBranchB([], compare, onDisable, () => {});

    expect(result.disabled).toBe(0);
    expect(result.skipped).toBe(0);
    expect(onDisable).not.toHaveBeenCalled();
    expect(compare).not.toHaveBeenCalled();
  });

  it("never logs password hashes or plaintext", async () => {
    const secretHash = "$2a$12$verysecret";
    const candidates: CandidateRow[] = [
      { id: 1, username: "viewer", passwordHash: secretHash },
    ];
    const compare = vi.fn().mockResolvedValue(false);
    const logs: string[] = [];

    await purgeBranchB(candidates, compare, () => Promise.resolve({ affected: 1 }), (line) => logs.push(line));

    for (const line of logs) {
      expect(line).not.toContain(secretHash);
      expect(line).not.toContain("viewer-password");
    }
  });
});

describe("back-substitution with real bcrypt (回代验算)", () => {
  // 回代验算（强制）：用真实 bcrypt hash 代入决策逻辑，
  // 验证"泄漏口令 hash → 禁用"和"轮换口令 hash → 跳过"。
  it("row 1: real bcrypt hash of leaked password viewer-password → shouldDisable=true", async () => {
    const leakedHash = bcrypt.hashSync(LEAKED_VIEWER_PASSWORD, 12);
    const row: CandidateRow = { id: 100, username: "viewer", passwordHash: leakedHash };

    const decision = await decidePurge(row, (plain, hash) =>
      Promise.resolve(bcrypt.compareSync(plain, hash)),
    );

    expect(decision.shouldDisable).toBe(true);
  });

  it("row 2: real bcrypt hash of rotated password → shouldDisable=false (not disabled)", async () => {
    const rotatedHash = bcrypt.hashSync("a-strong-rotated-password-2026", 12);
    const row: CandidateRow = { id: 101, username: "viewer", passwordHash: rotatedHash };

    const decision = await decidePurge(row, (plain, hash) =>
      Promise.resolve(bcrypt.compareSync(plain, hash)),
    );

    // Core fix: a legitimately rotated password must NOT be disabled.
    expect(decision.shouldDisable).toBe(false);
  });
});

describe("V-1: fetchCandidates SQL alias maps password_hash → passwordHash", () => {
  // Fake sql tag function that simulates real PostgreSQL column naming behavior:
  // - When the query has `AS "passwordHash"` (double-quoted alias), PG preserves
  //   case → returned object key is `passwordHash` (camelCase).
  // - Without the alias, PG returns the raw column name `password_hash` (snake_case).
  // postgres v3 (porsager) maps result columns to object keys verbatim — no transform.
  function createFakeSql(leakedHash: string) {
    const fakeSql = (strings: TemplateStringsArray) => {
      const query = strings.join("");
      const hasAlias = /password_hash\s+AS\s+"passwordHash"/i.test(query);
      if (hasAlias) {
        return Promise.resolve([
          { id: 1, username: "viewer", passwordHash: leakedHash },
        ]);
      }
      // Bug path: PG returns snake_case column name
      return Promise.resolve([
        { id: 1, username: "viewer", password_hash: leakedHash },
      ]);
    };
    return fakeSql as unknown as postgres.Sql;
  }

  it("returns rows with passwordHash field defined (not undefined)", async () => {
    const leakedHash = bcrypt.hashSync(LEAKED_VIEWER_PASSWORD, 12);
    const rows = await fetchCandidates(createFakeSql(leakedHash));

    expect(rows[0]).toBeDefined();
    expect(rows[0]!.passwordHash).toBe(leakedHash);
    expect(rows[0]!.passwordHash).not.toBeUndefined();
  });

  it("decidePurge receives correct passwordHash and identifies the leaked credential", async () => {
    const leakedHash = bcrypt.hashSync(LEAKED_VIEWER_PASSWORD, 12);
    const rows = await fetchCandidates(createFakeSql(leakedHash));

    expect(rows[0]).toBeDefined();
    // End-to-end: fetchCandidates → decidePurge with real bcrypt
    const decision = await decidePurge(rows[0]!, (plain, hash) =>
      Promise.resolve(bcrypt.compareSync(plain, hash)),
    );

    // If passwordHash were undefined (the bug), decidePurge treats it as null
    // and returns shouldDisable=false without calling compare.
    expect(decision.shouldDisable).toBe(true);
  });
});

describe("V-3: TOCTOU guard in purgeBranchB", () => {
  it("counts affected=0 as skipped (state changed in purge window)", async () => {
    const candidates: CandidateRow[] = [
      { id: 1, username: "viewer", passwordHash: "$2a$12$leaked" },
    ];
    const compare = vi.fn().mockResolvedValue(true); // matches leaked
    // Simulate TOCTOU: UPDATE affected 0 rows (state changed in window)
    const onDisable = vi.fn().mockResolvedValue({ affected: 0 });
    const logs: string[] = [];

    const result = await purgeBranchB(candidates, compare, onDisable, (line) => logs.push(line));

    expect(result.disabled).toBe(0);
    expect(result.skipped).toBe(1);
    expect(onDisable).toHaveBeenCalledTimes(1);

    const skipLog = logs.find((l) => l.includes("SKIP") && l.includes("id=1"));
    expect(skipLog).toBeDefined();
    expect(skipLog).toContain("state changed during purge window");
    expect(skipLog).toContain("manual review");
    // Must not leak hash
    expect(skipLog).not.toContain("$2a$12$leaked");
  });

  it("counts affected=1 as disabled (normal path regression)", async () => {
    const candidates: CandidateRow[] = [
      { id: 1, username: "viewer", passwordHash: "$2a$12$leaked" },
    ];
    const compare = vi.fn().mockResolvedValue(true);
    const onDisable = vi.fn().mockResolvedValue({ affected: 1 });
    const logs: string[] = [];

    const result = await purgeBranchB(candidates, compare, onDisable, (line) => logs.push(line));

    expect(result.disabled).toBe(1);
    expect(result.skipped).toBe(0);
    expect(logs.some((l) => l.includes("disabled user id=1"))).toBe(true);
  });

  it("mixed: one normal disable + one TOCTOU skip", async () => {
    const candidates: CandidateRow[] = [
      { id: 1, username: "viewer", passwordHash: "$2a$12$h1" },
      { id: 2, username: "viewer", passwordHash: "$2a$12$h2" },
    ];
    const compare = vi.fn().mockResolvedValue(true);
    const onDisable = vi.fn()
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 0 });
    const logs: string[] = [];

    const result = await purgeBranchB(candidates, compare, onDisable, (line) => logs.push(line));

    expect(result.disabled).toBe(1);
    expect(result.skipped).toBe(1);
    expect(logs.some((l) => l.includes("disabled user id=1"))).toBe(true);
    const toctouLog = logs.find((l) => l.includes("SKIP user id=2"));
    expect(toctouLog).toBeDefined();
    expect(toctouLog).toContain("state changed");
  });
});

describe("V-3: disableCandidate TOCTOU guard on UPDATE", () => {
  it("returns affected=1 when UPDATE matches the row (normal path)", async () => {
    const row: CandidateRow = { id: 1, username: "viewer", passwordHash: "$2a$12$hash" };

    // postgres v3: result is an array with .count = affected rows
    const fakeResult = Object.assign([], { count: 1 });
    const sqlMock = vi.fn().mockResolvedValue(fakeResult);
    const fakeSql = sqlMock as unknown as postgres.Sql;

    const result = await disableCandidate(fakeSql, row);

    expect(result.affected).toBe(1);
    // Verify the UPDATE includes TOCTOU guard conditions
    const callArg = sqlMock.mock.calls[0]![0];
    expect(String(callArg)).toContain("password_hash");
  });

  it("returns affected=0 when UPDATE matches no rows (state changed)", async () => {
    const row: CandidateRow = { id: 1, username: "viewer", passwordHash: "$2a$12$oldhash" };

    const fakeResult = Object.assign([], { count: 0 });
    const sqlMock = vi.fn().mockResolvedValue(fakeResult);
    const fakeSql = sqlMock as unknown as postgres.Sql;

    const result = await disableCandidate(fakeSql, row);

    expect(result.affected).toBe(0);
  });
});
