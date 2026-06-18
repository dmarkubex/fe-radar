import { describe, it, expect } from "vitest";
import { getTimePeriod, getRelativeDayLabel, groupTimeline } from "../timeline-grouping";

import type { TimelineItemDto } from "@/lib/api/timeline-query";

// ---- fixture helpers ----
function makeItem(publishedAt: string, id: number = 1): TimelineItemDto {
  return {
    id,
    publishedAt,
    scoredAt: null,
    title: `item-${id}`,
    url: "https://example.com",
    sourceName: "TestSource",
    sourceTier: "T1",
    sourceCategory: null,
    clusterId: null,
    qualityScore: 5,
    alertLevel: null,
    alertType: null,
    topCircle: null,
    summaryZh: null,
    category: null,
    eventType: null,
    relatedCount: 0
  };
}

describe("getTimePeriod", () => {
  // Asia/Shanghai 小时边界
  it("00:00 归凌晨(dawn)", () => {
    expect(getTimePeriod("2026-06-18T00:00:00+08:00")).toBe("dawn");
  });
  it("05:59 归凌晨(dawn)", () => {
    expect(getTimePeriod("2026-06-18T05:59:00+08:00")).toBe("dawn");
  });
  it("06:00 归上午(morning)", () => {
    expect(getTimePeriod("2026-06-18T06:00:00+08:00")).toBe("morning");
  });
  it("11:59 归上午(morning)", () => {
    expect(getTimePeriod("2026-06-18T11:59:00+08:00")).toBe("morning");
  });
  it("12:00 归下午(afternoon)", () => {
    expect(getTimePeriod("2026-06-18T12:00:00+08:00")).toBe("afternoon");
  });
  it("17:59 归下午(afternoon)", () => {
    expect(getTimePeriod("2026-06-18T17:59:00+08:00")).toBe("afternoon");
  });
  it("18:00 归晚间(evening)", () => {
    expect(getTimePeriod("2026-06-18T18:00:00+08:00")).toBe("evening");
  });
  it("23:59 归晚间(evening)", () => {
    expect(getTimePeriod("2026-06-18T23:59:00+08:00")).toBe("evening");
  });
});

describe("getRelativeDayLabel", () => {
  const now = "2026-06-18T00:30:00+08:00"; // 06-18 00:30 CST

  it("今天：06-18 某时刻", () => {
    expect(getRelativeDayLabel("2026-06-18T00:05:00+08:00", now)).toBe("今天");
  });
  it("昨天：06-17 某时刻", () => {
    expect(getRelativeDayLabel("2026-06-17T23:55:00+08:00", now)).toBe("昨天");
  });
  it("更早返回 M月D日 星期X 格式", () => {
    // 2026-06-16 是星期二
    const label = getRelativeDayLabel("2026-06-16T10:00:00+08:00", now);
    expect(label).toBe("6月16日 星期二");
  });

  // 跨午夜 TZ 边界测试（核心 acceptance 5）
  it("跨午夜 TZ 边界：23:55 CST(前一日) 给定 now=次日00:30 判为昨天", () => {
    // now=06-18 00:30 CST，item=06-17 23:55 CST → 昨天
    expect(getRelativeDayLabel("2026-06-17T23:55:00+08:00", "2026-06-18T00:30:00+08:00")).toBe("昨天");
  });
  it("跨午夜 TZ 边界：00:05 CST(当日) 给定 now=同日00:30 判为今天", () => {
    // now=06-18 00:30 CST，item=06-18 00:05 CST → 今天
    expect(getRelativeDayLabel("2026-06-18T00:05:00+08:00", "2026-06-18T00:30:00+08:00")).toBe("今天");
  });
});

describe("groupTimeline", () => {
  it("空 items 返回空数组", () => {
    expect(groupTimeline([])).toEqual([]);
  });

  it("同一天的 items 归入同一 dayGroup", () => {
    const items = [
      makeItem("2026-06-18T10:00:00+08:00", 1),
      makeItem("2026-06-18T14:00:00+08:00", 2)
    ];
    const groups = groupTimeline(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.dayKey).toBe("2026-06-18");
    // 合计 2 条，分布在 morning + afternoon
    const periodCounts = groups[0]!.periods.map((p) => p.items.length);
    expect(periodCounts.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("日倒序：最新日在前", () => {
    const items = [
      makeItem("2026-06-16T10:00:00+08:00", 1),
      makeItem("2026-06-18T10:00:00+08:00", 2),
      makeItem("2026-06-17T10:00:00+08:00", 3)
    ];
    const groups = groupTimeline(items);
    expect(groups.map((g) => g.dayKey)).toEqual(["2026-06-18", "2026-06-17", "2026-06-16"]);
  });

  it("段倒序：同一天内 晚间>下午>上午>凌晨", () => {
    const items = [
      makeItem("2026-06-18T02:00:00+08:00", 1), // dawn
      makeItem("2026-06-18T08:00:00+08:00", 2), // morning
      makeItem("2026-06-18T14:00:00+08:00", 3), // afternoon
      makeItem("2026-06-18T20:00:00+08:00", 4) // evening
    ];
    const groups = groupTimeline(items);
    expect(groups).toHaveLength(1);
    const periods = groups[0]!.periods.map((p) => p.period);
    expect(periods).toEqual(["evening", "afternoon", "morning", "dawn"]);
  });

  it("空段不渲染（只有晚间时，periods 只含 evening）", () => {
    const items = [makeItem("2026-06-18T20:00:00+08:00", 1)];
    const groups = groupTimeline(items);
    expect(groups[0]!.periods).toHaveLength(1);
    expect(groups[0]!.periods[0]!.period).toBe("evening");
  });

  // 核心 acceptance 5: 跨午夜边界分入不同日组
  it("跨午夜 TZ 边界：23:55 与次日 00:05 分入不同日组", () => {
    const items = [
      makeItem("2026-06-17T23:55:00+08:00", 1), // 06-17 晚间
      makeItem("2026-06-18T00:05:00+08:00", 2) // 06-18 凌晨
    ];
    const groups = groupTimeline(items);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.dayKey).toBe("2026-06-18"); // 日倒序，新日在前
    expect(groups[1]!.dayKey).toBe("2026-06-17");
    // 00:05 归 06-18 凌晨
    expect(groups[0]!.periods[0]!.period).toBe("dawn");
    expect(groups[0]!.periods[0]!.items[0]!.id).toBe(2);
    // 23:55 归 06-17 晚间
    expect(groups[1]!.periods[0]!.period).toBe("evening");
    expect(groups[1]!.periods[0]!.items[0]!.id).toBe(1);
  });

  // acceptance 6: variant="list" 扁平不分组——groupTimeline 输出的 periods 条目数正确
  it("groupTimeline 段内 label 带条数信息（label 字段为时段中文名）", () => {
    const items = [
      makeItem("2026-06-18T14:00:00+08:00", 1),
      makeItem("2026-06-18T15:00:00+08:00", 2)
    ];
    const groups = groupTimeline(items);
    expect(groups[0]!.periods[0]!.label).toBe("下午");
    expect(groups[0]!.periods[0]!.items).toHaveLength(2);
  });
});

// acceptance 6: variant='list' 非回归。本仓库无 DOM 测试基建(@testing-library/react
// / jsdom 均未安装, vitest 为 node 环境, 全 web 包无 .test.tsx 渲染测试), 故以
// 结构性保证替代渲染断言: list 分支渲染的是原始 flatMap items 数组, 只要 groupTimeline
// 不修改/不重排该数组, list 模式即不受分组重构影响(timeline-list.tsx 中 list 分支为
// items.map(TimelineCard), 不调用 groupTimeline)。
describe("variant='list' 非回归(结构性保证)", () => {
  it("groupTimeline 不修改输入数组(list 渲染原始 items)", () => {
    const items = [
      makeItem("2026-06-18T10:00:00+08:00", 1),
      makeItem("2026-06-17T20:00:00+08:00", 2),
      makeItem("2026-06-18T02:00:00+08:00", 3)
    ];
    const before = items.map((i) => i.id);
    groupTimeline(items);
    expect(items.map((i) => i.id)).toEqual(before); // 原数组顺序/长度不变
  });

  it("groupTimeline 段内保留输入相对顺序(不重排 item)", () => {
    const items = [
      makeItem("2026-06-18T14:00:00+08:00", 10),
      makeItem("2026-06-18T15:00:00+08:00", 11),
      makeItem("2026-06-18T16:00:00+08:00", 12)
    ];
    const afternoon = groupTimeline(items)[0]!.periods[0]!;
    expect(afternoon.items.map((i) => i.id)).toEqual([10, 11, 12]); // 入序保持
  });
});
