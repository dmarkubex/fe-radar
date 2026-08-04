import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(__dirname, "../../migrations/0051_source_gate0_batch4_seed.sql"),
  "utf8"
);

describe("0051 Gate 0 batch 4 source seed", () => {
  it("adds three disabled official candidates without overwriting admin data", () => {
    expect(sql).toContain("ON CONFLICT (url) DO NOTHING");
    expect(sql).not.toMatch(/UPDATE\s+sources/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+sources/i);
    expect(sql.match(/\n\s*false\s*\)/g)).toHaveLength(3);

    for (const url of [
      "https://www.nexans.com/news-media-room/press-releases/",
      "https://digitalpower.huawei.com/en/news",
      "https://www.evebattery.com/news"
    ])
      expect(sql).toContain(url);
  });

  it("covers cable, storage, upstream and downstream domains", () => {
    for (const domain of ["competitors", "products", "upstream", "downstream"])
      expect(sql).toContain(`'${domain}'`);

    expect(sql.match(/'maxAgeHours', 2160/g)).toHaveLength(3);
    expect(sql).not.toContain("远东电缆");
  });

  it("documents soft-disable rollback only", () => {
    expect(sql).toContain("回滚：只软禁本批 URL");
    expect(sql).toContain("已有引用的 source 行不物理删除");
  });
});
