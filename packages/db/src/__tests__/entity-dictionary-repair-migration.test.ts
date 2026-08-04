import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(__dirname, "../../migrations/0052_entity_dictionary_repair.sql"),
  "utf8"
);

function extractSeedRows(source: string): Map<string, string[]> {
  return new Map(
    [...source.matchAll(/\('company',\s*'([^']+)',\s*ARRAY\[([^\]]*)\]::text\[\],\s*'C2'\)/g)].map(
      (match) => [
        match[1]!,
        [...match[2]!.matchAll(/'([^']+)'/g)].map((alias) => alias[1]!)
      ]
    )
  );
}

describe("0052 entity dictionary repair migration", () => {
  it("adds the fourteen approved C2 entities with row-scoped aliases", () => {
    const expected: Record<string, string[]> = {
      东方电缆: ["宁波东方电缆"],
      中国电建: ["中国电力建设集团", "POWERCHINA"],
      阳光电源: ["Sungrow"],
      华为数字能源: ["Huawei Digital Power", "Huawei"],
      海博思创: ["HyperStrong"],
      Nexans: ["Nexans Group"],
      万科: ["万科企业", "万科集团"],
      保利: ["保利发展", "保利地产"],
      华润置地: ["华润置地有限公司"],
      龙湖: ["龙湖集团"],
      绿地: ["绿地控股", "绿地集团"],
      明阳智能: ["明阳智慧能源", "MingYang"],
      中国能建: ["中国能源建设集团", "CEEC"],
      科华数能: ["科华数据", "Kehua Tech"]
    };
    const rows = extractSeedRows(sql);

    for (const [name, aliases] of Object.entries(expected)) {
      expect(rows.get(name), `aliases for ${name}`).toEqual(aliases);
    }
    expect([...rows.keys()]).toEqual(Object.keys(expected));
    expect(rows).toHaveLength(14);
  });

  it("only fills a null circle and appends missing aliases", () => {
    const upsertSql = sql.slice(0, sql.indexOf("-- 完整指纹"));

    expect(upsertSql).toContain("ON CONFLICT (type, canonical_name) DO UPDATE");
    expect(upsertSql).toMatch(/circle\s*=\s*COALESCE\(entities\.circle, EXCLUDED\.circle\)/);
    expect(upsertSql).toMatch(/unnest\(EXCLUDED\.aliases\)/);
    expect(upsertSql).toMatch(/NOT seed_alias = ANY/);
    expect(upsertSql).not.toMatch(/\bUPDATE\s+entities\b/i);
    expect(upsertSql).not.toMatch(/\b(meta|weight)\s*=/i);
  });

  it("deletes only the two production-verified test fingerprints", () => {
    for (const fragment of [
      "canonical_name = '测试实体'",
      "aliases = ARRAY['测试', 'test']::text[]",
      "canonical_name = '测试公司_Test2026'",
      "aliases = ARRAY['测试别名', 'TestAlias']::text[]",
      "circle IS NULL",
      "weight = 1.0",
      "meta IS NULL"
    ])
      expect(sql).toContain(fragment);

    expect(sql.indexOf("DELETE FROM item_entities")).toBeLessThan(
      sql.indexOf("DELETE FROM entities")
    );
    expect(sql).toMatch(
      /WHERE NOT EXISTS \(\s*SELECT 1\s*FROM entity_financials ef\s*WHERE ef\.entity_id = entities\.id\s*\)/
    );
    expect(sql).toContain("skipped_financial=%");
    expect(sql).not.toMatch(/DELETE[\s\S]*type\s*=\s*'policy'/i);
    expect(sql).toContain("RAISE NOTICE");
  });
});
