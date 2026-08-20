import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { StandardItem } from "../../types";
import {
  applyAnnouncementEntityFilter,
  buildCompanyNameSet,
  DEFAULT_ENTITY_FILTER_SEPARATORS,
  filterAnnouncementsByEntity,
  matchesCompanyName,
  normalizeCompanyKey,
  parseCompanyPrefix,
  type CompanyNameRow
} from "../entity-filter";
import { fetchAnnouncements, registerAnnouncementAdapter } from "../index";

const here = dirname(fileURLToPath(import.meta.url));

const MIGRATION_0066 = resolve(
  here,
  "../../../../../../packages/db/migrations/0066_company_entities_c3.sql"
);
const TITLES_FIXTURE = resolve(here, "fixtures/announcement-titles.json");

const MUST_INCLUDE = [
  "威胜信息",
  "通光线缆",
  "特锐德",
  "多氟多",
  "明阳电气",
  "赣锋锂业",
  "深圳能源",
  "运达股份",
  "泓淋电力",
  "龙源电力",
  "湖南裕能",
  "港迪技术"
] as const;

interface SeedRow {
  canonicalName: string;
  aliases: string[];
  circle: string;
}

interface TitleSample {
  source_id: number;
  title: string;
  keep: boolean;
}

function parseMigration0066(sql: string): SeedRow[] {
  const rowRe =
    /\('company',\s*'([^']+)',\s*ARRAY\[([\s\S]*?)\]::text\[\],\s*'(C3)',\s*1\.0\)/g;
  const rows: SeedRow[] = [];
  for (const match of sql.matchAll(rowRe)) {
    const aliases = [...match[2]!.matchAll(/'([^']+)'/g)].map(
      (item) => item[1]!
    );
    rows.push({
      canonicalName: match[1]!,
      aliases,
      circle: match[3]!
    });
  }
  return rows;
}

function seedToRows(seeds: SeedRow[]): CompanyNameRow[] {
  return seeds.map((row) => ({
    canonicalName: row.canonicalName,
    aliases: row.aliases
  }));
}

function item(title: string): StandardItem {
  return {
    title,
    url: `https://example.com/${encodeURIComponent(title)}`,
    content: "",
    publishedAt: new Date("2026-08-15T00:00:00.000Z")
  };
}

const migrationSql = readFileSync(MIGRATION_0066, "utf8");
const seedRows = parseMigration0066(migrationSql);
const nameSet = buildCompanyNameSet(seedToRows(seedRows));

describe("0066 C3 dictionary (source of truth for tests)", () => {
  it("parses 120–200 company rows, all C3, including the 12 backtest names", () => {
    expect(seedRows.length).toBeGreaterThanOrEqual(120);
    expect(seedRows.length).toBeLessThanOrEqual(200);
    expect(seedRows.every((row) => row.circle === "C3")).toBe(true);
    expect(migrationSql).toContain(
      "ON CONFLICT (type, canonical_name) DO NOTHING"
    );
    expect(migrationSql).not.toMatch(/'C1'|'C2'/);
    for (const name of MUST_INCLUDE) {
      expect(seedRows.map((row) => row.canonicalName)).toContain(name);
    }
  });
});

describe("parseCompanyPrefix / normalizeCompanyKey", () => {
  it("takes the first space (cninfo) or fullwidth colon (szse)", () => {
    expect(
      parseCompanyPrefix(
        "威胜信息 2026年半年度报告摘要",
        DEFAULT_ENTITY_FILTER_SEPARATORS
      )
    ).toBe("威胜信息");
    expect(
      parseCompanyPrefix(
        "多氟多：第八届董事会第十次会议决议公告",
        DEFAULT_ENTITY_FILTER_SEPARATORS
      )
    ).toBe("多氟多");
  });

  it("uses the first separator when the title contains more later", () => {
    expect(
      parseCompanyPrefix(
        "湖南裕能：关于向香港联交所递交境外上市外资股（H股）发行并上市申请并刊发申请资料的公告",
        DEFAULT_ENTITY_FILTER_SEPARATORS
      )
    ).toBe("湖南裕能");
  });

  it("strips market suffixes and mixed spaces", () => {
    expect(normalizeCompanyKey("来凯医药-B")).toBe("来凯医药");
    expect(normalizeCompanyKey("先瑞达医疗-Ｂ")).toBe("先瑞达医疗");
    expect(normalizeCompanyKey("中通快递-W")).toBe("中通快递");
    expect(normalizeCompanyKey("赣锋锂业(H股)")).toBe("赣锋锂业");
    expect(normalizeCompanyKey("  特锐德  ")).toBe("特锐德");
    expect(normalizeCompanyKey("ST南都")).toBe("南都");
  });
});

describe("company name match", () => {
  it("matches canonical name or alias after prefix parse", () => {
    const set = buildCompanyNameSet([
      { canonicalName: "通光线缆", aliases: ["江苏通光"] }
    ]);
    expect(
      matchesCompanyName(
        parseCompanyPrefix(
          "通光线缆 重大合同预中标提示性公告",
          DEFAULT_ENTITY_FILTER_SEPARATORS
        ),
        set
      )
    ).toBe(true);
    expect(
      matchesCompanyName(
        parseCompanyPrefix(
          "江苏通光：重大合同预中标提示性公告",
          DEFAULT_ENTITY_FILTER_SEPARATORS
        ),
        set
      )
    ).toBe(true);
    expect(
      matchesCompanyName(
        parseCompanyPrefix(
          "恩华药业：2026年半年度报告",
          DEFAULT_ENTITY_FILTER_SEPARATORS
        ),
        set
      )
    ).toBe(false);
  });

  it("returns [] when every item is filtered (business idle window, not a fetch error)", () => {
    const set = buildCompanyNameSet([
      { canonicalName: "通光线缆", aliases: [] }
    ]);
    const kept = applyAnnouncementEntityFilter(
      [item("恩华药业：2026年半年度报告")],
      set,
      "巨潮资讯"
    );
    expect(kept).toEqual([]);
  });
});

describe("production title backtest (640 announcements)", () => {
  const samples = JSON.parse(
    readFileSync(TITLES_FIXTURE, "utf8")
  ) as TitleSample[];
  const keepSamples = samples.filter((row) => row.keep);
  const dropSamples = samples.filter((row) => !row.keep);
  const keptPositive = filterAnnouncementsByEntity(
    keepSamples.map((row) => item(row.title)),
    nameSet,
    DEFAULT_ENTITY_FILTER_SEPARATORS
  );
  const keptNoise = filterAnnouncementsByEntity(
    dropSamples.map((row) => item(row.title)),
    nameSet,
    DEFAULT_ENTITY_FILTER_SEPARATORS
  );
  const recalled = keptPositive.length;
  const discarded = dropSamples.length - keptNoise.length;

  it(`backtest recall kept=${recalled}/${keepSamples.length} precision discarded=${discarded}/${dropSamples.length}`, () => {
    expect(samples).toHaveLength(640);
    expect(keepSamples).toHaveLength(19);
    expect(dropSamples).toHaveLength(621);
    expect(recalled).toBeGreaterThanOrEqual(17);
    expect(discarded).toBeGreaterThanOrEqual(500);
  });
});

describe("fetchAnnouncements entityFilter hook", () => {
  const adapterName = "stub-entity-filter-adapter";

  it("leaves items unchanged when entityFilter is omitted", async () => {
    const sample = item("恩华药业：2026年半年度报告");
    registerAnnouncementAdapter({
      name: adapterName,
      fetch: async () => [sample]
    });
    const items = await fetchAnnouncements(
      { type: "announcement", adapter: adapterName },
      { sourceName: "其他公告源" }
    );
    expect(items).toEqual([sample]);
  });

  it("keeps matching companies and returns [] for a full miss without throwing", async () => {
    registerAnnouncementAdapter({
      name: adapterName,
      fetch: async () => [
        item("通光线缆 重大合同预中标提示性公告"),
        item("恩华药业：2026年半年度报告")
      ]
    });
    const loadCompanyNames = async (): Promise<CompanyNameRow[]> => [
      { canonicalName: "通光线缆", aliases: [] }
    ];

    const kept = await fetchAnnouncements(
      {
        type: "announcement",
        adapter: adapterName,
        entityFilter: { enabled: true }
      },
      { sourceName: "巨潮资讯" },
      { loadCompanyNames }
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.title).toBe("通光线缆 重大合同预中标提示性公告");

    const empty = await fetchAnnouncements(
      {
        type: "announcement",
        adapter: adapterName,
        entityFilter: { enabled: true }
      },
      { sourceName: "深交所披露" },
      {
        loadCompanyNames: async () => [
          { canonicalName: "威胜信息", aliases: [] }
        ]
      }
    );
    expect(empty).toEqual([]);
  });
});
