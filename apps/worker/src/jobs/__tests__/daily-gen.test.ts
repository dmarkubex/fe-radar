import { describe, expect, it, vi } from "vitest";
import { LlmError } from "@fe-radar/shared";
import { buildDailyReportInput, DAILY_REPORT_BLOCKED_SUMMARY, runDailyGen } from "../daily-gen";

import type { LlmClient } from "@fe-radar/llm";

describe("daily-gen", () => {
  it("builds five-section prompt input from curated items", () => {
    const input = buildDailyReportInput([{ title: "储能项目", sourceName: "北极星", category: "项目与招投标", summaryZh: "中标摘要", scoredAt: new Date("2026-05-11T00:00:00Z") }]);
    expect(input).toContain("标题：储能项目");
    expect(input).toContain("摘要：中标摘要");
  });

  it("pauses when too many items need manual scrub", async () => {
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            innerJoin: () => ({
              where: () => ({
                orderBy: () => ({
                  limit: async () => Array.from({ length: 5 }, (_, index) => ({
                    title: `item-${index}`,
                    sourceName: "source",
                    category: "公司与资本",
                    summaryZh: DAILY_REPORT_BLOCKED_SUMMARY,
                    scoredAt: new Date()
                  }))
                })
              })
            })
          })
        })
      })
    };
    const llm = { chatJson: vi.fn() } as unknown as LlmClient;
    await expect(runDailyGen(llm, { db: db as never })).rejects.toBeInstanceOf(LlmError);
    expect(llm.chatJson).not.toHaveBeenCalled();
  });
});
