import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_PATH = join(__dirname, "../../migrations/0014_sources_seed_v3.sql");

describe("0014_sources_seed_v3 migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");

  it("updates 工信部 and 中电联 URLs", () => {
    expect(sql).toContain("WHERE name = '工信部'");
    expect(sql).toContain("https://www.miit.gov.cn/xwdt/gxdt/index.html");
    expect(sql).toContain("WHERE name = '中电联'");
    expect(sql).toContain("https://www.cec.org.cn/yaowen/index.jhtml");
  });

  it("contains key government and association source names", () => {
    for (const name of ["国家发改委", "中国电器工业协会", "中关村储能产业技术联盟 CNESA", "中国电力新闻网", "索比光伏网", "国际能源网"]) {
      expect(sql).toContain(name);
    }
  });

  it("contains corrected selector strings", () => {
    expect(sql).toContain("ul.u-list > li");
    expect(sql).toContain(".list ul li, .cata-list li");
    expect(sql).toContain(".list-ul li, ul.list li, #list li");
    expect(sql).toContain(".notice-list.tab-con.active p.text-of");
    expect(sql).toContain("article.et-item");
    expect(sql).toContain("ul.infoList > li");
    expect(sql).toMatch(/\.xNews_left a\[href\*=\\"news\.solarbe\.com\/20\\"\]/);
    expect(sql).toContain(".listTxt h5 a");
  });

  it("keeps unstable live-smoke sources disabled with verify comments", () => {
    expect(sql).toContain("❌ verify 2026-05-28: current agent network cannot reach ndrc.gov.cn");
    expect(sql).toContain("❌ verify 2026-05-28: current agent network cannot reach .gov.cn");
    expect(sql).toContain("❌ verify 2026-05-28: Planner smoke reached HTTP 200 but selector matched 0 items");
    expect(sql).toContain("❌ verify 2026-05-28: smoke regressed from 72 items to 0 across environments");
    expect(sql).toMatch(/enabled\s+= false[\s\S]*?WHERE name = '工信部'/);
    expect(sql).toMatch(/enabled\s+= false[\s\S]*?WHERE name = '中电联'/);
  });
});
