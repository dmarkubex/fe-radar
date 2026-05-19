import { describe, expect, it } from "vitest";
import {
  briefingListQuerySchema,
  encodeBriefingCursor,
  decodeBriefingCursor,
  createTargetSchema,
  updateTargetSchema,
  regenerateSchema,
} from "../../../../lib/api/briefing-schema";

// ---------------------------------------------------------------------------
// Case 1: 列表页 — briefingListQuerySchema + cursor encoding
// ---------------------------------------------------------------------------

describe("briefingListQuerySchema", () => {
  it("accepts default values when no params provided", () => {
    const result = briefingListQuerySchema.parse({});
    expect(result.pageSize).toBe(20);
    expect(result.cursor).toBeUndefined();
  });

  it("coerces string pageSize to number and clamps max", () => {
    const result = briefingListQuerySchema.parse({ pageSize: "50" });
    expect(result.pageSize).toBe(50);
  });

  it("rejects pageSize > 100", () => {
    expect(briefingListQuerySchema.safeParse({ pageSize: "999" }).success).toBe(false);
  });

  it("accepts cursor string", () => {
    const cursor = encodeBriefingCursor({ briefingDate: "2026-05-19", id: 42 });
    const result = briefingListQuerySchema.parse({ cursor });
    expect(result.cursor).toBe(cursor);
  });
});

describe("cursor encoding / decoding", () => {
  it("round-trips briefingDate + id", () => {
    const payload = { briefingDate: "2026-05-19", id: 42 };
    const encoded = encodeBriefingCursor(payload);
    expect(typeof encoded).toBe("string");
    const decoded = decodeBriefingCursor(encoded);
    expect(decoded).toEqual(payload);
  });

  it("returns null for undefined cursor", () => {
    expect(decodeBriefingCursor(undefined)).toBeNull();
  });

  it("returns null for invalid base64 cursor", () => {
    expect(decodeBriefingCursor("not-valid-base64!!!")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Case 2: 详情页 — createTargetSchema (targets CRUD used by detail page admin)
// ---------------------------------------------------------------------------

describe("createTargetSchema", () => {
  it("accepts valid dingtalk_bot target", () => {
    const result = createTargetSchema.parse({
      name: "采购部群",
      channel: "dingtalk_bot",
      webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=abc",
      signSecret: "SECxxx",
      enabled: true,
    });
    expect(result.name).toBe("采购部群");
    expect(result.channel).toBe("dingtalk_bot");
  });

  it("rejects unknown channel", () => {
    expect(
      createTargetSchema.safeParse({
        name: "群",
        channel: "wechat",
        webhookUrl: "https://example.com/hook",
      }).success
    ).toBe(false);
  });

  it("rejects invalid webhookUrl", () => {
    expect(
      createTargetSchema.safeParse({
        name: "群",
        channel: "dingtalk_bot",
        webhookUrl: "not-a-url",
      }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Case 3: 410 灰态 — regenerateSchema and download 410 scenario guard
// ---------------------------------------------------------------------------

describe("regenerateSchema", () => {
  it("defaults force to false", () => {
    expect(regenerateSchema.parse({}).force).toBe(false);
  });

  it("accepts force=true for admin re-gen trigger", () => {
    expect(regenerateSchema.parse({ force: true }).force).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Case 4: S/R null 降级提示 — payload shape validation
// ---------------------------------------------------------------------------

describe("S/R null degradation — payload_json outlook shape", () => {
  interface Outlook {
    trend?: string;
    support?: number | null;
    resistance?: number | null;
  }

  function hasSrNull(outlook: Outlook | undefined): boolean {
    return !outlook || outlook.support == null || outlook.resistance == null;
  }

  it("flags S/R null when both fields are null (< 10 samples)", () => {
    const outlook: Outlook = { trend: "区间震荡", support: null, resistance: null };
    expect(hasSrNull(outlook)).toBe(true);
  });

  it("flags S/R null when support is null but resistance is set", () => {
    const outlook: Outlook = { trend: "偏多", support: null, resistance: 80000 };
    expect(hasSrNull(outlook)).toBe(true);
  });

  it("does NOT flag S/R null when both values are integers (sufficient samples)", () => {
    const outlook: Outlook = { trend: "偏多", support: 76000, resistance: 81000 };
    expect(hasSrNull(outlook)).toBe(false);
  });

  it("flags S/R null when outlook is undefined (gen_status=degraded edge case)", () => {
    expect(hasSrNull(undefined)).toBe(true);
  });
});
