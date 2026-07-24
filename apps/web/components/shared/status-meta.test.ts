import { describe, expect, it } from "vitest";
import {
  alertStripClass,
  alertTypeBadgeClass,
  alertTypeLabel,
} from "./alert-meta";
import { SOURCE_HEALTH_META } from "./source-health-meta";

describe("shared status metadata", () => {
  it("keeps risk alert copy and color on the shared warning token", () => {
    expect(alertTypeLabel("risk")).toBe("竞品风险");
    expect(alertTypeBadgeClass("risk")).toContain("text-warn");
    expect(alertStripClass("risk", "C2")).toBe("bg-warn");
  });

  it("keeps source health labels and tones paired", () => {
    expect(SOURCE_HEALTH_META.healthy).toEqual({
      label: "正常",
      className: "text-ok",
    });
    expect(SOURCE_HEALTH_META.failing).toEqual({
      label: "失败",
      className: "text-danger",
    });
  });
});
