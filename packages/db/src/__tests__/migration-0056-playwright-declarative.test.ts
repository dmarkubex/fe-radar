import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(__dirname, "../../migrations/0056_playwright_declarative_extractors.sql");

describe("0056 playwright declarative extractors migration (T-SEC-03)", () => {
  const sql = readFileSync(migrationPath, "utf8");

  it("removes the editor-controlled extractor field and writes declarative selectors", () => {
    expect(sql).toContain("itemSelector");
    expect(sql).toContain("titleSelector");
    expect(sql).toContain("linkSelector");
    expect(sql).toContain("limit");
    expect(sql).toContain("(config - 'extractor')");
  });

  it("only updates rows that still carry an extractor key (idempotent)", () => {
    expect(sql).toContain("WHERE config ? 'extractor'");
  });

  it("matches querySelectorAll (with the All) — not bare querySelector (CRIT-2 regression guard)", () => {
    // 旧 seed 全用 document.querySelectorAll(...)；只匹配 querySelector 会让所有行落到空 itemSelector
    // 兜底分支，导致 Playwright 信源全部失效。用 dollar-quoting 表达，避免单引号转义错配。
    expect(sql).toContain("$re$querySelectorAll?\\('([^']+)'\\)$re$");
  });

  it("uses dollar-quoting for regexes so single-quote escaping cannot break the literal (CRIT-2)", () => {
    // 复核 CRIT-2：旧版本用标准字符串字面量 + '' 转义，引号不配平导致迁移 PARSE 失败、
    // 事务回滚、0057/0058/0059 全部不执行。dollar-quoting 根除该类错误。
    expect(sql).toMatch(/\$re\$.*\$re\$/);
    // 不应再出现标准字符串字面量里裸露的 querySelectorAll 转义形态。
    expect(sql).not.toMatch(/'querySelectorAll\?/);
  });

  it("has balanced transaction boundaries (BEGIN/COMMIT present exactly once each)", () => {
    expect((sql.match(/\bBEGIN\b/g) ?? []).length).toBe(1);
    expect((sql.match(/\bCOMMIT\b/g) ?? []).length).toBe(1);
  });

  it("documents a manual rollback (config restoration from seed)", () => {
    expect(sql).toContain("ROLLBACK");
  });
});
