import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(__dirname, "../../migrations/0047_source_gate0_seed.sql"),
  "utf8"
);

describe("0047 Gate 0 source seed", () => {
  it("adds exactly five disabled candidates without overwriting admin data", () => {
    expect(sql).toContain("ON CONFLICT (url) DO NOTHING");
    expect(sql).not.toMatch(/UPDATE\s+sources/i);
    expect(sql.match(/\n\s*false\s*\)/g)).toHaveLength(5);
    for (const url of [
      "https://www.orientcable.com/ajax.asp?p=ajax_news_list&l=cn&a=1",
      "https://ecp.sgcc.com.cn/ecp2.0/portal/",
      "https://www.bidding.csg.cn/zbcg/index.jhtml",
      "https://bid.powerchina.cn/index",
      "https://www.chnenergybidding.com.cn/bidweb/"
    ])
      expect(sql).toContain(url);
    expect(sql).not.toContain("https://www.fe-cable.com/news.html");
  });

  it("marks all four procurement platforms as tender signals", () => {
    expect(
      sql.match(/'signalKinds', jsonb_build_array\('tender'\)/g)
    ).toHaveLength(4);
    expect(sql).toContain("'adapter', 'sgcc-tender'");
    expect(sql).toContain("'adapter', 'powerchina-tender'");
    expect(sql).toContain("'adapter', 'chnenergy-tender'");
  });

  it("contains no destructive rollback", () => {
    expect(sql).not.toMatch(/DELETE\s+FROM\s+sources/i);
    expect(sql).toContain("仅在零引用时删除");
  });
});
