import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("0049 Exchange API source", () => {
  it("seeds one disabled, idempotent USD/CNY quotes source", () => {
    const sql = readFileSync(
      resolve(__dirname, "../../migrations/0049_exchange_rate_api_source.sql"),
      "utf8",
    );
    expect(sql).toContain("'adapter', 'exchange-api'");
    expect(sql).toContain("jsonb_build_array('fx_usdcny')");
    expect(sql).toMatch(/'市场数据',\s*false/);
    expect(sql).toContain("ON CONFLICT (url) DO NOTHING");
    expect(sql).toContain("SET label = 'USD/CNY 参考汇率'");
    expect(sql).toContain("AND label = '美元中间价'");
  });
});
