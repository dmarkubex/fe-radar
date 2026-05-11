import { describe, expect, it } from "vitest";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";
import { retentionCutoff } from "../cleanup";

describe("cleanup job", () => {
  it("computes the 90-day retention cutoff in Asia/Shanghai", () => {
    const cutoff = retentionCutoff(new Date("2026-05-11T00:00:00Z"));
    expect(cutoff.date).toBe(dayjs("2026-05-11T00:00:00Z").tz(APP_TIMEZONE).subtract(90, "day").format("YYYY-MM-DD"));
  });
});
