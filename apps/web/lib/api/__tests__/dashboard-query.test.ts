import { describe, expect, it } from "vitest";

import { countAlertsByType } from "../dashboard-query";

describe("dashboard query helpers", () => {
  it("counts legal alerts in dashboard totals", () => {
    expect(countAlertsByType([
      { alertType: "legal" },
      { alertType: "own" },
      { alertType: "legal" },
      { alertType: "policy" },
      { alertType: "unknown" },
      { alertType: null }
    ])).toEqual({
      own: 1,
      safety: 0,
      policy: 1,
      legal: 2
    });
  });
});
