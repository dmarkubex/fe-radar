import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  __dirname,
  "../../migrations/0045_seed_circle_entities.sql"
);
const migration0019Path = resolve(
  __dirname,
  "../../migrations/0019_c2_stock_entities_litigation.sql"
);

const sql = readFileSync(migrationPath, "utf8");
const sql0019 = readFileSync(migration0019Path, "utf8");

/** Extract ('canonical_name', 'stock_code') pairs from 0019 VALUES mapping. */
function extract0019CanonicalNames(source: string): string[] {
  const block = source.match(
    /FROM \(VALUES([\s\S]*?)\) AS mapping\(canonical_name, stock_code\)/
  );
  const valuesBody = block?.[1];
  if (!valuesBody) return [];
  return [...valuesBody.matchAll(/\('([^']+)',\s*'[^']+'\)/g)].map(
    (m) => m[1]!
  );
}

type SeedRow = {
  canonicalName: string;
  aliasesLiteral: string;
  circle: "C1" | "C2";
  metaLiteral: string;
  stockCode: string | null;
};

/**
 * Parse each INSERT VALUES row as its own unit so stockCode / aliases assertions
 * cannot cross-row match (F3: the old "name then stockCode within 200 chars" regex
 * was a false green — deleting 12/14 stockCodes still passed).
 */
function extractSeedRows(source: string): SeedRow[] {
  const rowRe =
    /\('company',\s*'([^']+)',\s*ARRAY\[([\s\S]*?)\]::text\[\],\s*'(C[12])',\s*1\.0,\s*(NULL|'\{[^']*\}'::jsonb)\)/g;
  const rows: SeedRow[] = [];
  for (const m of source.matchAll(rowRe)) {
    const metaLiteral = m[4]!;
    const stockMatch = metaLiteral.match(/"stockCode"\s*:\s*"([^"]+)"/);
    rows.push({
      canonicalName: m[1]!,
      aliasesLiteral: m[2]!,
      circle: m[3] as "C1" | "C2",
      metaLiteral,
      stockCode: stockMatch?.[1] ?? null
    });
  }
  return rows;
}

function extractSeedCanonicalNames(source: string): string[] {
  return extractSeedRows(source).map((r) => r.canonicalName);
}

/** 0019 mapping: canonical_name → stock_code (byte-for-byte with 0019 VALUES). */
const STOCK_CODE_BY_NAME: Record<string, string> = {
  远东智慧能源: "600869",
  远东股份: "600869",
  宝胜股份: "600973",
  中天科技: "600522",
  亨通光电: "600487",
  起帆电缆: "605222",
  金杯电工: "002533",
  江西铜业: "600362",
  铜陵有色: "000630",
  云南铜业: "000878",
  宁德时代: "300750",
  比亚迪: "002594",
  亿纬锂能: "300014",
  国轩高科: "002074"
};

describe("0045 seed circle entities migration", () => {
  const rows = extractSeedRows(sql);

  it("is a new migration (does not edit 0001–0044)", () => {
    expect(sql).toContain("0045_seed_circle_entities");
    expect(sql).toContain("INSERT INTO entities");
    expect(sql).not.toContain("UPDATE entities");
  });

  it("seeds only legal C1/C2 circle values", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(["C1", "C2"]).toContain(r.circle);
    }
    // Parser only accepts C1|C2; also assert raw SQL has no C3 assignment.
    expect(sql).not.toMatch(/,\s*'C3',\s*1\.0/);
  });

  it("uses type=company for all seeded rows (including regulators)", () => {
    const types = [
      ...sql.matchAll(/\('(company|policy|event_type)',\s*'/g)
    ].map((m) => m[1]!);
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((t) => t === "company")).toBe(true);
    // Rationale comment present for regulators.
    expect(sql).toMatch(/直接监管.*company|type=company.*监管/s);
  });

  it("uses conditional ON CONFLICT DO UPDATE (fill null circle, never blind overwrite)", () => {
    expect(sql).toContain("ON CONFLICT (type, canonical_name) DO UPDATE");
    expect(sql).toMatch(/WHERE\s+entities\.circle\s+IS\s+NULL/);
    expect(sql).not.toContain("ON CONFLICT (type, canonical_name) DO NOTHING");
    expect(sql).toMatch(
      /WITH\s+seed[\s\S]*upserted\s+AS\s*\(\s*INSERT INTO entities/
    );
    expect(sql).not.toMatch(/FROM\s*\(\s*INSERT\s+INTO/i);
    // Existing aliases/meta win; seed values only fill missing entries/keys.
    expect(sql).toMatch(/unnest\(EXCLUDED\.aliases\)/);
    expect(sql).toMatch(/NOT seed_alias = ANY/);
    expect(sql).toMatch(/EXCLUDED\.meta\s*\|\|\s*COALESCE\(entities\.meta/);
    // Non-silent: NOTICE reports inserted / updated / skipped
    expect(sql).toContain("RAISE NOTICE");
    expect(sql).toMatch(/inserted=%/);
    expect(sql).toMatch(/updated_null_circle=%/);
    expect(sql).toMatch(/skipped_existing_nonnull_circle=%/);
    expect(sql).toContain("(SELECT count(*) FROM seed) AS total");
    expect(sql).not.toMatch(/\b28\s*-\s*\(SELECT count/);
  });

  it("aligns every 0019 stockCode on the same seed row (no cross-row false green)", () => {
    const from0019 = extract0019CanonicalNames(sql0019);
    const fromSeed = extractSeedCanonicalNames(sql);

    expect(from0019).toEqual([
      "远东智慧能源",
      "远东股份",
      "宝胜股份",
      "中天科技",
      "亨通光电",
      "起帆电缆",
      "金杯电工",
      "江西铜业",
      "铜陵有色",
      "云南铜业",
      "宁德时代",
      "比亚迪",
      "亿纬锂能",
      "国轩高科"
    ]);

    expect(Object.keys(STOCK_CODE_BY_NAME)).toEqual(from0019);

    for (const name of from0019) {
      expect(fromSeed).toContain(name);
      const row = rows.find((r) => r.canonicalName === name);
      expect(row, `missing seed row for ${name}`).toBeDefined();
      // Exact stockCode on THIS row only — mutating another row's meta must not pass.
      expect(row!.stockCode).toBe(STOCK_CODE_BY_NAME[name]);
    }

    // Names without 0019 mapping must not carry a stockCode in their own meta.
    for (const row of rows) {
      if (!(row.canonicalName in STOCK_CODE_BY_NAME)) {
        expect(row.stockCode).toBeNull();
      }
    }
  });

  it("covers requirements §5.1 C1 core list and §5.2 C2 competitors + upstream", () => {
    const c1 = [
      "远东控股集团",
      "远东电缆",
      "远东智慧能源",
      "远东智慧能源股份",
      "远东股份",
      "国家电网",
      "南方电网",
      "国家能源局",
      "国家发改委",
      "工信部",
      "国家电投",
      "华能",
      "华电",
      "大唐",
      "国家能源集团"
    ];
    const c2 = [
      "宝胜股份",
      "江南电缆",
      "中天科技",
      "亨通光电",
      "起帆电缆",
      "金杯电工",
      "江西铜业",
      "铜陵有色",
      "云南铜业",
      "宁德时代",
      "比亚迪",
      "亿纬锂能",
      "国轩高科"
    ];
    for (const name of [...c1, ...c2]) {
      expect(extractSeedCanonicalNames(sql)).toContain(name);
    }
    // Exactly 28 company seed rows (15 C1 + 13 C2). 省网 are aliases, not extra rows.
    expect(extractSeedCanonicalNames(sql)).toHaveLength(28);
  });

  it("includes aliases for known parenthetical synonyms from requirements §5.2 + OWN", () => {
    // §5.2 parentheticals must sit on the correct competitor row (not merely appear in file).
    const mustHave: Record<string, string[]> = {
      宝胜股份: ["宝胜电缆"],
      江南电缆: ["江苏江南电缆"],
      中天科技: ["中天电缆", "中天海缆"],
      亨通光电: ["亨通电缆", "亨通海缆"],
      远东控股集团: ["远东控股"],
      远东智慧能源: ["远东智慧"]
    };
    for (const [canonical, aliases] of Object.entries(mustHave)) {
      const row = rows.find((r) => r.canonicalName === canonical);
      expect(row, `missing row ${canonical}`).toBeDefined();
      for (const a of aliases) {
        expect(row!.aliasesLiteral).toContain(`'${a}'`);
      }
    }
  });

  it("seeds 省网 as C1 aliases of 国家电网/南方电网 (spec §5.1, not §5.2 C2)", () => {
    const stateGridProvincials = [
      "国网北京市电力公司",
      "国网天津市电力公司",
      "国网河北省电力有限公司",
      "国网冀北电力有限公司",
      "国网山西省电力公司",
      "国网山东省电力公司",
      "国网上海市电力公司",
      "国网江苏省电力有限公司",
      "国网浙江省电力有限公司",
      "国网安徽省电力有限公司",
      "国网福建省电力有限公司",
      "国网湖北省电力有限公司",
      "国网湖南省电力有限公司",
      "国网河南省电力公司",
      "国网江西省电力有限公司",
      "国网四川省电力公司",
      "国网重庆市电力公司",
      "国网辽宁省电力有限公司",
      "国网吉林省电力有限公司",
      "国网黑龙江省电力有限公司",
      "国网内蒙古东部电力有限公司",
      "国网陕西省电力有限公司",
      "国网甘肃省电力公司",
      "国网青海省电力公司",
      "国网宁夏电力有限公司",
      "国网新疆电力有限公司",
      "国网西藏电力有限公司"
    ];
    const southernGridProvincials = [
      "广东电网有限责任公司",
      "广西电网有限责任公司",
      "云南电网有限责任公司",
      "贵州电网有限责任公司",
      "海南电网有限责任公司"
    ];
    const sg = rows.find((r) => r.canonicalName === "国家电网");
    const csg = rows.find((r) => r.canonicalName === "南方电网");
    expect(sg?.circle).toBe("C1");
    expect(csg?.circle).toBe("C1");
    for (const alias of stateGridProvincials) {
      expect(sg!.aliasesLiteral).toContain(`'${alias}'`);
    }
    for (const alias of southernGridProvincials) {
      expect(csg!.aliasesLiteral).toContain(`'${alias}'`);
    }
    expect(sg!.aliasesLiteral).toContain("'江苏省电力有限公司'");
    expect(sg!.aliasesLiteral).toContain("'浙江省电力有限公司'");
    expect(sg!.aliasesLiteral).toContain("'国网蒙东电力'");
    // Documented choice (a) + §5.1 vs §5.2 contradiction note
    expect(sql).toMatch(/§5\.1.*C1|依据 §5\.1/s);
    expect(sql).toMatch(/§5\.2.*矛盾|规格矛盾/s);
    expect(sql).toMatch(/省网/);
  });

  it("documents 国家能源局 policy/company coexistence as harmless (no DELETE)", () => {
    expect(sql).toMatch(/国家能源局.*policy|policy.*国家能源局/s);
    expect(sql).toMatch(/并存|不删除|无害/);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+entities/i);
  });
});
