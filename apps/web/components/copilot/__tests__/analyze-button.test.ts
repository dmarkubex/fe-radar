import { describe, expect, it } from "vitest";
import { shouldShowAnalyzeButton } from "../visibility";

describe("shouldShowAnalyzeButton（三布尔组合）", () => {
  it("copilotEnabled && copilotEligible && !citationMode → 显示", () => {
    expect(
      shouldShowAnalyzeButton({ copilotEnabled: true, copilotEligible: true })
    ).toBe(true);
  });

  it("灰度关闭 → null", () => {
    expect(
      shouldShowAnalyzeButton({ copilotEnabled: false, copilotEligible: true })
    ).toBe(false);
  });

  it("条目不可 copilot → null", () => {
    expect(
      shouldShowAnalyzeButton({ copilotEnabled: true, copilotEligible: false })
    ).toBe(false);
  });

  it("citationMode（引用弹层内）→ null", () => {
    expect(
      shouldShowAnalyzeButton({
        citationMode: true,
        copilotEnabled: true,
        copilotEligible: true
      })
    ).toBe(false);
  });

  it("三者任一不满足都不显示（全组合）", () => {
    for (const enabled of [false, true]) {
      for (const eligible of [false, true]) {
        for (const citationMode of [false, true]) {
          expect(
            shouldShowAnalyzeButton({
              citationMode,
              copilotEligible: eligible,
              copilotEnabled: enabled
            })
          ).toBe(enabled && eligible && !citationMode);
        }
      }
    }
  });
});
