import { describe, expect, it } from "vitest";
import {
  CU_CHANGE_METRIC,
  CU_MAIN_METRIC,
  CU_SPOT_METRIC,
  formatChangePctDisplay,
  formatPriceDisplay,
  indexQuoteValues,
  pickMetalDayQuotes,
} from "../briefing-quote-display";

describe("indexQuoteValues / pickMetalDayQuotes", () => {
  it("picks main + spot + change for the same day", () => {
    const byKey = indexQuoteValues([
      { metricKey: CU_MAIN_METRIC, value: "107330" },
      { metricKey: CU_SPOT_METRIC, value: 108060 },
      { metricKey: CU_CHANGE_METRIC, value: "-0.0001" },
    ]);
    expect(pickMetalDayQuotes(byKey, CU_MAIN_METRIC, CU_SPOT_METRIC, CU_CHANGE_METRIC)).toEqual({
      mainClose: 107330,
      spot: 108060,
      changePct: -0.0001,
    });
  });

  it("returns nulls when only main exists", () => {
    const byKey = indexQuoteValues([{ metricKey: CU_MAIN_METRIC, value: 107340 }]);
    expect(pickMetalDayQuotes(byKey, CU_MAIN_METRIC, CU_SPOT_METRIC, CU_CHANGE_METRIC)).toEqual({
      mainClose: 107340,
      spot: null,
      changePct: null,
    });
  });

  it("returns all null when empty", () => {
    expect(pickMetalDayQuotes(new Map(), CU_MAIN_METRIC, CU_SPOT_METRIC, CU_CHANGE_METRIC)).toEqual({
      mainClose: null,
      spot: null,
      changePct: null,
    });
  });

  it("ignores non-finite values", () => {
    const byKey = indexQuoteValues([
      { metricKey: CU_MAIN_METRIC, value: "not-a-number" },
      { metricKey: CU_SPOT_METRIC, value: null },
    ]);
    expect(byKey.size).toBe(0);
  });
});

describe("formatPriceDisplay / formatChangePctDisplay", () => {
  it("formats prices with locale separators", () => {
    expect(formatPriceDisplay(108060)).toBe("108,060");
    expect(formatPriceDisplay(null)).toBe("—");
  });

  it("formats change_pct as percent string", () => {
    expect(formatChangePctDisplay(-0.0001)).toBe("-0.01%");
    expect(formatChangePctDisplay(0.0065)).toBe("0.65%");
    expect(formatChangePctDisplay(null)).toBeNull();
  });
});
