import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  __dirname,
  "../../migrations/0042_finance_source_keyword_filters.sql"
);
const sql = readFileSync(migrationPath, "utf8");

/** Live SQL between BEGIN and COMMIT (excludes header + rollback comments). */
function liveSqlBody(source: string): string {
  const begin = source.indexOf("BEGIN;");
  const commit = source.indexOf("COMMIT;");
  if (begin < 0 || commit < 0 || commit <= begin) {
    throw new Error("migration missing BEGIN/COMMIT markers");
  }
  return source.slice(begin, commit);
}

describe("0042 finance source keyword filters migration", () => {
  const body = liveSqlBody(sql);

  it("installs keywordFilter by URL natural key for all four sources", () => {
    for (const url of [
      "https://36kr.com/information/web_news/",
      "https://www.yicai.com/news/energy/",
      "https://www.jiemian.com/lists/55.html",
      "https://finance.ifeng.com/"
    ]) {
      expect(body).toContain(`url = '${url}'`);
    }
    for (const keyword of [
      "电缆",
      "储能",
      "光纤",
      "光缆",
      "光通信",
      "OPGW",
      "ADSS"
    ]) {
      expect(body).toContain(`"${keyword}"`);
    }

    // Four filter installs: each is SET config=...keywordFilter... WHERE url=... (no name)
    const filterInstalls = [
      ...body.matchAll(
        /UPDATE sources\s+SET config = config \|\| '\{"keywordFilter":\[[^\]]+\]\}'::jsonb\s+WHERE url = '([^']+)'\s+AND config->'keywordFilter' IS NULL;/g
      )
    ];
    expect(filterInstalls).toHaveLength(4);
    expect(filterInstalls.map((m) => m[1])).toEqual([
      "https://36kr.com/information/web_news/",
      "https://www.yicai.com/news/energy/",
      "https://www.jiemian.com/lists/55.html",
      "https://finance.ifeng.com/"
    ]);
  });

  it("preserves an admin-supplied keyword filter", () => {
    expect(body.match(/config->'keywordFilter' IS NULL/g)).toHaveLength(4);
  });

  it("renames only by original seed name (decoupled from filter install)", () => {
    // rename statements are SET name only — not coupled to keywordFilter install
    const renames = [
      ...body.matchAll(
        /UPDATE sources\s+SET name = '([^']+)'\s+WHERE name(?: = '([^']+)'| IN \(([^)]+)\))\s+AND url = '([^']+)';/g
      )
    ];
    expect(renames).toHaveLength(3);

    expect(body).toContain("name = '36氪 新能源'");
    expect(body).toContain("name = '36氪 快讯（全站）'");
    expect(body).toContain("name = '第一财经 能源'");
    expect(body).toContain("name = '第一财经 头条（全站）'");
    expect(body).toContain("'凤凰财经 能源', '凤凰财经-能源'");
    expect(body).toContain("name = '凤凰财经 能源'");

    // 界面新闻 has no rename — only keywordFilter install
    expect(body).not.toContain("界面新闻");

    // no single UPDATE that both renames and installs keywordFilter
    expect(body).not.toMatch(
      /SET name\s*=[\s\S]*?keywordFilter[\s\S]*?WHERE/i
    );
  });

  it("does not mutate the source natural-key URLs", () => {
    expect(body).not.toMatch(/SET\s+url\s*=/);
  });
});
