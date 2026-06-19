import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(__dirname, "../../migrations/0027_smm_quotes_sources.sql");

describe("0027 SMM quotes sources migration", () => {
  it("uses a new migration instead of editing the 0009 commodity seed", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("0027_smm_quotes_sources");
    expect(sql).toContain("不修改 0009");
  });

  it("enables SMM copper and lithium quote sources with smm-hq adapter", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("https://hq.smm.cn/h5/cu");
    expect(sql).toContain("https://hq.smm.cn/h5/Li2CO3");
    expect(sql.match(/"adapter": "smm-hq"/g)).toHaveLength(2);
    expect(sql).toContain('"cu_main_close"');
    expect(sql).toContain('"lc_main_close"');
    expect(sql).toContain('"cu_spot_smm"');
    expect(sql).toContain('"lc_spot_smm"');
  });

  it("only disables copper/lithium quote sources replaced by SMM", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/UPDATE sources\s+SET enabled = false\s+WHERE fetcher_type = 'quotes'/);
    expect(sql).toContain("'SHFE 沪铜主力'");
    expect(sql).toContain("'GFEX 碳酸锂主力'");
    expect(sql).toContain("'RSSHub 数值抽取-SMM 铜'");
    expect(sql).toContain("'RSSHub 数值抽取-SMM 碳酸锂'");
    expect(sql).toContain("(config->'metric_keys') ?| ARRAY['cu_main_close', 'lc_main_close']");
    expect(sql).not.toContain("'LME 伦铜'");
    expect(sql).not.toContain("'央行汇率中间价'");
    expect(sql).not.toContain("'中国货币网 10Y 国债'");
    expect(sql).not.toContain("'RSSHub 数值抽取-SMM 铝'");
    expect(sql).not.toContain("'RSSHub 数值抽取-SMM 锌'");
  });

  it("resets SMM failure state", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("fail_count = 0");
    expect(sql).toContain("last_error = NULL");
  });
});
