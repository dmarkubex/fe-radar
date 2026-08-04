import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(__dirname, "../../migrations/0050_source_gate0_batch3_seed.sql"),
  "utf8"
);

describe("0050 Gate 0 batch 3 source seed", () => {
  it("adds four disabled official candidates without overwriting admin data", () => {
    expect(sql).toContain("ON CONFLICT (url) DO NOTHING");
    expect(sql).not.toMatch(/UPDATE\s+sources/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+sources/i);
    expect(sql.match(/\n\s*false\s*\)/g)).toHaveLength(4);

    for (const url of [
      "https://news.lscns.com/feed/",
      "https://www.prysmian.com/en/media/press-releases?field_press_category_new_tid=1704",
      "https://www.catl.com/en/news/",
      "https://www.sungrowpower.com/en/news-media-news-list"
    ])
      expect(sql).toContain(url);
  });

  it("covers cable, submarine cable, storage, upstream and downstream domains", () => {
    for (const domain of ["competitors", "products", "upstream", "downstream"])
      expect(sql).toContain(`'${domain}'`);

    expect(sql.match(/'maxAgeHours', 2160/g)).toHaveLength(4);
    expect(sql).not.toContain("远东电缆");
  });

  it("documents soft-disable rollback only", () => {
    expect(sql).toContain("回滚：只软禁本批 URL");
    expect(sql).toContain("已有引用的 source 行不物理删除");
  });
});
