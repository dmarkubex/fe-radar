import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  __dirname,
  "../../migrations/0044_block_robots_disallowed_verification.sql"
);
const sql = readFileSync(migrationPath, "utf8");

const DENYLIST_URLS = [
  "https://www.solarbe.com/news/",
  "https://weixin.sogou.com/weixin?type=1&query=%E7%94%B5%E7%BC%86%E5%A4%B4%E6%9D%A1",
  "https://weixin.sogou.com/weixin?type=1&query=%E5%82%A8%E8%83%BD%E5%A4%B4%E6%9D%A1",
  "https://xueqiu.com/k?q=%E7%94%B5%E7%BC%86"
];

describe("0044 robots verification block migration", () => {
  it("keeps all explicitly disallowed sources disabled", () => {
    for (const url of DENYLIST_URLS) {
      expect(sql).toContain(`'${url}'`);
    }
    expect(sql).toContain("enabled = false");
  });

  it("persists a generic verification block in DB config", () => {
    expect(sql).toContain('"verificationBlocked":true');
    expect(sql).toContain("robots.txt explicitly disallows target path");
  });

  it("matches on the immutable url key rather than the admin-editable name", () => {
    expect(sql).toContain("WHERE url IN (");
    expect(sql).not.toContain("WHERE name IN (");
    for (const name of ["索比光伏网", "电缆头条", "储能头条", "雪球 行业讨论"]) {
      expect(sql).not.toContain(`'${name}'`);
    }
  });

  it("fails loudly instead of silently matching zero rows", () => {
    expect(sql).toContain("RAISE EXCEPTION");
    // The guard counts the denylist rows (not the rows updated) so it stays
    // true on a re-run rather than tripping on an already-applied migration.
    expect(sql).toMatch(/SELECT count\(\*\) FROM sources WHERE url IN/);
    expect(sql).toContain("<> 4");
  });
});
