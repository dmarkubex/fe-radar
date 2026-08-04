import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(__dirname, "../../migrations/0048_source_gate0_batch2_seed.sql"),
  "utf8"
);

describe("0048 Gate 0 batch 2 source seed", () => {
  it("adds seven disabled official candidates without overwriting admin data", () => {
    expect(sql).toContain("ON CONFLICT (url) DO NOTHING");
    expect(sql).not.toMatch(/UPDATE\s+sources/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+sources/i);
    expect(sql.match(/\n\s*false\s*\)/g)).toHaveLength(7);

    for (const url of [
      "https://m.ztt.cn/news_list.html",
      "https://www.jncable.com.cn/cn/news.html",
      "https://www.shqfdl.com/m/news.aspx",
      "https://www.cnesa.org/information/?column_id=1",
      "https://dl.sungrowpower.com/news.html?class_id=6",
      "https://www.hyperstrong.com/cn/news/company-news",
      "https://www.gotion.com.cn/news"
    ])
      expect(sql).toContain(url);
  });

  it("covers cable, submarine cable, storage, upstream and downstream domains", () => {
    for (const domain of [
      "competitors",
      "products",
      "industry_policy",
      "upstream",
      "downstream"
    ])
      expect(sql).toContain(`'${domain}'`);

    expect(sql.match(/'maxAgeHours', 2160/g)).toHaveLength(7);
    expect(sql).not.toContain("远东电缆");
  });

  it("documents soft-disable rollback only", () => {
    expect(sql).toContain("回滚：只软禁本批 URL");
    expect(sql).toContain("已有引用的 source 行不物理删除");
  });
});
