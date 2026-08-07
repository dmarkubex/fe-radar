import { describe, expect, it } from "vitest";

import {
  BRIEFING_SNIPPET_MAX_CHARS,
  DAILY_SECTION_MAX_CHARS,
  buildDailyPushCard,
  hasDailyContent,
  joinBaseUrl,
  normalizeBaseUrl,
  truncateText,
  type BriefingCardPayload,
} from "../daily-push-card";

const BASE = "http://fe-radar.internal";

const fullSections = {
  policy: "国家能源局发布新能源消纳新规。",
  market: "电缆招标量环比回升。",
  tech: "高压电缆新工艺落地。",
  project: "某省特高压线路开工。",
  company: "远东股份中标电网框架。",
};

const briefingPayload = {
  cu: { logic_summary: "库存去化", outlook: { trend: "偏多" } },
  lc: { logic_summary: "供给过剩", outlook: { trend: "区间震荡" } },
  macro_summary: "宏观偏暖",
  procurement_advice: "刚需少量补库",
};

describe("hasDailyContent", () => {
  it("returns false for null, undefined, and empty object", () => {
    expect(hasDailyContent(null)).toBe(false);
    expect(hasDailyContent(undefined)).toBe(false);
    expect(hasDailyContent({})).toBe(false);
    expect(hasDailyContent({ policy: "  " })).toBe(false);
  });

  it("returns true when any of the five sections has text", () => {
    expect(hasDailyContent({ market: "有内容" })).toBe(true);
  });
});

describe("truncateText / normalizeBaseUrl / joinBaseUrl", () => {
  it("truncates by Unicode code points", () => {
    expect(truncateText("abcdef", 4)).toBe("abc…");
    expect(truncateText("你好世界朋友", 3)).toBe("你好…");
    expect(truncateText("短", 10)).toBe("短");
  });

  it("normalizes baseUrl and strips trailing slashes", () => {
    expect(normalizeBaseUrl("http://fe-radar.internal/")).toBe("http://fe-radar.internal");
    expect(normalizeBaseUrl("https://example.com///")).toBe("https://example.com");
  });

  it("rejects non-http(s) and invalid baseUrl", () => {
    expect(() => normalizeBaseUrl("ftp://x")).toThrow(/http\/https/);
    expect(() => normalizeBaseUrl("not-a-url")).toThrow(/非法 baseUrl/);
    expect(() => normalizeBaseUrl("javascript:alert(1)")).toThrow();
  });

  it("joins fixed relative paths safely", () => {
    expect(joinBaseUrl(BASE, "/daily?date=2026-08-06")).toBe(
      "http://fe-radar.internal/daily?date=2026-08-06"
    );
    expect(joinBaseUrl(`${BASE}/`, "/briefing/12")).toBe(
      "http://fe-radar.internal/briefing/12"
    );
  });
});

describe("buildDailyPushCard — content combinations", () => {
  it("daily only: title/sections/button, no briefing button", () => {
    const card = buildDailyPushCard({
      reportDate: "2026-08-06",
      baseUrl: BASE,
      dailySections: fullSections,
      briefing: null,
    });
    expect(card.title).toContain("日报");
    expect(card.title).toContain("2026-08-06");
    expect(card.text).toContain("政策");
    expect(card.text).toContain("市场");
    expect(card.text).toContain("技术");
    expect(card.text).toContain("项目");
    expect(card.text).toContain("公司");
    // DingTalk ActionCard needs blank lines between sections (single \n collapses).
    expect(card.text).toMatch(
      /\*\*政策\*\*：[^\n]+\n\n\*\*市场\*\*：[^\n]+\n\n\*\*技术\*\*：[^\n]+\n\n\*\*项目\*\*：[^\n]+\n\n\*\*公司\*\*：/
    );
    expect(card.btns).toHaveLength(1);
    expect(card.btns[0]).toEqual({
      title: "查看产业日报",
      actionURL: "http://fe-radar.internal/daily?date=2026-08-06",
    });
  });

  it("briefing only: language fields + briefing button", () => {
    const card = buildDailyPushCard({
      reportDate: "2026-08-06",
      baseUrl: BASE,
      dailySections: null,
      briefing: { id: 42, genStatus: "succeeded", payload: briefingPayload },
    });
    expect(card.title).toContain("铜锂");
    expect(card.text).toContain("偏多");
    expect(card.text).toContain("区间震荡");
    expect(card.text).toContain("宏观偏暖");
    expect(card.btns).toEqual([
      {
        title: "查看铜锂行情简报",
        actionURL: "http://fe-radar.internal/briefing/42",
      },
    ]);
  });

  it("both present: merged title and two buttons in fixed order", () => {
    const card = buildDailyPushCard({
      reportDate: "2026-08-06",
      baseUrl: `${BASE}/`,
      dailySections: fullSections,
      briefing: { id: 7, genStatus: "degraded", payload: briefingPayload },
    });
    expect(card.title).toContain("合并日报");
    expect(card.btns.map((b) => b.title)).toEqual([
      "查看产业日报",
      "查看铜锂行情简报",
    ]);
    expect(card.btns[0]?.actionURL).toBe(
      "http://fe-radar.internal/daily?date=2026-08-06"
    );
    expect(card.btns[1]?.actionURL).toBe("http://fe-radar.internal/briefing/7");
  });

  it("neither present throws", () => {
    expect(() =>
      buildDailyPushCard({
        reportDate: "2026-08-06",
        baseUrl: BASE,
        dailySections: {},
        briefing: null,
      })
    ).toThrow(/均不存在/);
  });

  it("truncates long daily sections deterministically", () => {
    const long = "甲".repeat(DAILY_SECTION_MAX_CHARS + 40);
    const card = buildDailyPushCard({
      reportDate: "2026-08-06",
      baseUrl: BASE,
      dailySections: { policy: long },
    });
    const match = card.text.match(/\*\*政策\*\*：(.+)/);
    expect(match?.[1]).toBeDefined();
    expect(Array.from(match![1]!).length).toBe(DAILY_SECTION_MAX_CHARS);
    expect(match![1]!.endsWith("…")).toBe(true);
  });

  it("shows genStatus when briefing payload has no language fields", () => {
    const card = buildDailyPushCard({
      reportDate: "2026-08-06",
      baseUrl: BASE,
      briefing: { id: 9, genStatus: "degraded", payload: {} },
    });
    expect(card.text).toContain("生成状态：degraded");
  });

  it("does not invent numeric price fields from free text", () => {
    const roguePayload = {
      cu: { outlook: { trend: "偏多" }, close: 78520 },
      lc: { outlook: { trend: "偏空" } },
    } as BriefingCardPayload;
    const card = buildDailyPushCard({
      reportDate: "2026-08-06",
      baseUrl: BASE,
      briefing: {
        id: 1,
        genStatus: "succeeded",
        payload: roguePayload,
      },
    });
    expect(card.text).toContain("偏多");
    expect(card.text).not.toMatch(/78520/);
    // snippet cap still applied
    const longTrend = "涨".repeat(BRIEFING_SNIPPET_MAX_CHARS + 20);
    const card2 = buildDailyPushCard({
      reportDate: "2026-08-06",
      baseUrl: BASE,
      briefing: {
        id: 2,
        payload: { cu: { outlook: { trend: longTrend } } },
      },
    });
    const line = card2.text.split("\n").find((l) => l.startsWith("铜："));
    expect(Array.from(line!.slice(2)).length).toBe(BRIEFING_SNIPPET_MAX_CHARS);
  });

  it("rejects illegal baseUrl when building card", () => {
    expect(() =>
      buildDailyPushCard({
        reportDate: "2026-08-06",
        baseUrl: "file:///etc/passwd",
        dailySections: fullSections,
      })
    ).toThrow(/http\/https/);
  });
});
