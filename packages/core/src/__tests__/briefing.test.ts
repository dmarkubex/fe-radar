import { describe, expect, it } from "vitest";
import {
  ZERO_BASE_FALLBACK,
  computePctChange,
  computeSupportResistance,
  degradeFields,
  formatMetricDisplay,
  isBusinessDay,
  mapTemplateFields,
  mergeDerivedChangePctQuotes,
} from "../briefing";

describe("computePctChange", () => {
  it("returns correct positive pct change", () => {
    const result = computePctChange(78268, 78520);
    expect(result).toBeCloseTo(0.003219, 4);
  });

  it("returns negative pct change", () => {
    const result = computePctChange(100, 80);
    expect(result).toBeCloseTo(-0.2, 5);
  });

  it("returns ZERO_BASE_FALLBACK when prev is 0", () => {
    expect(computePctChange(0, 500)).toBe(ZERO_BASE_FALLBACK);
    expect(ZERO_BASE_FALLBACK).toBe(0);
  });

  it("returns 0 for NaN inputs", () => {
    expect(computePctChange(NaN, 100)).toBe(0);
    expect(computePctChange(100, NaN)).toBe(0);
  });
});

describe("formatMetricDisplay", () => {
  it("formats *_change_pct as percentage string", () => {
    expect(formatMetricDisplay("cu_change_pct", 0.0067)).toBe("0.67%");
    expect(formatMetricDisplay("lc_change_pct", -0.02)).toBe("-2.00%");
  });

  it("formats non-pct metrics as plain string", () => {
    expect(formatMetricDisplay("cu_main_close", 78520)).toBe("78520");
  });

  it("returns null for missing values", () => {
    expect(formatMetricDisplay("cu_change_pct", null)).toBeNull();
    expect(formatMetricDisplay("cu_change_pct", undefined)).toBeNull();
  });
});

describe("mergeDerivedChangePctQuotes", () => {
  it("folds cu_change_pct / lc_change_pct into close.changePct and drops derived rows", () => {
    const quotes = [
      { metricKey: "cu_main_close", value: 78520, changePct: null, observedAt: new Date("2026-05-20") },
      { metricKey: "cu_change_pct", value: 0.0067, changePct: null, observedAt: new Date("2026-05-20") },
      { metricKey: "lc_main_close", value: 98000, changePct: null, observedAt: new Date("2026-05-20") },
      { metricKey: "lc_change_pct", value: -0.02, changePct: null, observedAt: new Date("2026-05-20") },
      { metricKey: "fx_usdcny", value: 7.2, changePct: null, observedAt: new Date("2026-05-20") },
    ];
    const merged = mergeDerivedChangePctQuotes(quotes);
    expect(merged.map((q) => q.metricKey)).toEqual(["cu_main_close", "lc_main_close", "fx_usdcny"]);
    expect(merged[0]!.changePct).toBeCloseTo(0.0067);
    expect(merged[1]!.changePct).toBeCloseTo(-0.02);
    expect(merged[2]!.changePct).toBeNull();
  });

  it("leaves close.changePct alone when no derived row exists", () => {
    const quotes = [
      { metricKey: "cu_main_close", value: 78520, changePct: 0.01, observedAt: new Date("2026-05-20") },
    ];
    const merged = mergeDerivedChangePctQuotes(quotes);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.changePct).toBe(0.01);
  });
});

describe("mapTemplateFields", () => {
  const quotes = [
    { metricKey: "cu_main_close", value: 78520, changePct: 0.32, observedAt: new Date("2026-05-19") },
    { metricKey: "lc_main_close", value: 87400, changePct: -1.15, observedAt: new Date("2026-05-19") },
    { metricKey: "cu_change_pct", value: 0.0067, changePct: null, observedAt: new Date("2026-05-19") },
  ];

  const templateFields = [
    { placeholderKey: "cu.price.shfe_main", sourceMetric: "cu_main_close", llmPath: null, fallbackText: "—" },
    { placeholderKey: "lc.price.gfex_main", sourceMetric: "lc_main_close", llmPath: null, fallbackText: "—" },
    { placeholderKey: "cu_change_pct", sourceMetric: "cu_change_pct", llmPath: null, fallbackText: "—" },
  ];

  it("maps all fields when quotes are present", () => {
    const result = mapTemplateFields(quotes, templateFields);
    expect(result["cu.price.shfe_main"]).toBe("78520");
    expect(result["lc.price.gfex_main"]).toBe("87400");
  });

  it("formats change_pct metrics as percentage", () => {
    const result = mapTemplateFields(quotes, templateFields);
    expect(result["cu_change_pct"]).toBe("0.67%");
  });

  it("returns null for missing metric key", () => {
    const fields = [
      { placeholderKey: "cu.price.unknown", sourceMetric: "nonexistent_metric", llmPath: null, fallbackText: "—" },
    ];
    const result = mapTemplateFields(quotes, fields);
    expect(result["cu.price.unknown"]).toBeNull();
  });

  it("returns null for fields with no sourceMetric", () => {
    const fields = [
      { placeholderKey: "static.footer", sourceMetric: null, llmPath: null, fallbackText: "—" },
    ];
    const result = mapTemplateFields([], fields);
    expect(result["static.footer"]).toBeNull();
  });
});

describe("isBusinessDay", () => {
  const holidays2026 = new Set(["2026-06-08"]);

  it("returns true for a regular Monday", () => {
    expect(isBusinessDay("2026-05-18", new Set())).toBe(true);
  });

  it("returns false for Saturday", () => {
    expect(isBusinessDay("2026-05-16", new Set())).toBe(false);
  });

  it("returns false for Sunday", () => {
    expect(isBusinessDay("2026-05-17", new Set())).toBe(false);
  });

  it("returns false for a holiday in the holiday set", () => {
    expect(isBusinessDay("2026-06-08", holidays2026)).toBe(false);
  });

  it("returns true for a weekday not in holiday set", () => {
    expect(isBusinessDay("2026-06-09", holidays2026)).toBe(true);
  });

  it("accepts a Date object", () => {
    expect(isBusinessDay(new Date("2026-05-18T00:00:00+08:00"), new Set())).toBe(true);
  });
});

describe("computeSupportResistance", () => {
  function makeSamples(count: number, base = 70000): { high: number; low: number; close: number }[] {
    return Array.from({ length: count }, (_, i) => ({
      high: base + 1000 + i * 10,
      low: base - 1000 + i * 5,
      close: base + i * 8,
    }));
  }

  it("returns null for both when samples < 10", () => {
    const result = computeSupportResistance(makeSamples(8));
    expect(result.support).toBeNull();
    expect(result.resistance).toBeNull();
  });

  it("returns null when samples is exactly 9", () => {
    const result = computeSupportResistance(makeSamples(9));
    expect(result.support).toBeNull();
    expect(result.resistance).toBeNull();
  });

  it("returns integer support and resistance for 20 samples", () => {
    const result = computeSupportResistance(makeSamples(20));
    expect(result.support).not.toBeNull();
    expect(result.resistance).not.toBeNull();
    expect(Number.isInteger(result.support)).toBe(true);
    expect(Number.isInteger(result.resistance)).toBe(true);
  });

  it("support is less than resistance for 20 samples", () => {
    const result = computeSupportResistance(makeSamples(20));
    expect(result.support!).toBeLessThan(result.resistance!);
  });

  it("uses only first 20 samples when more are provided", () => {
    const r20 = computeSupportResistance(makeSamples(20));
    const r30 = computeSupportResistance(makeSamples(30));
    expect(r20.support).toBe(r30.support);
    expect(r20.resistance).toBe(r30.resistance);
  });

  it("returns valid result for exactly 10 samples", () => {
    const result = computeSupportResistance(makeSamples(10));
    expect(result.support).not.toBeNull();
    expect(result.resistance).not.toBeNull();
  });

  it("computes correct values for known fixture", () => {
    // 20 identical samples: high=71000, low=69000, close=70000
    const samples = Array.from({ length: 20 }, () => ({ high: 71000, low: 69000, close: 70000 }));
    // pivot = (71000 + 69000 + 70000) / 3 = 70000
    // range = 71000 - 69000 = 2000
    // rawSupport = 70000 - 0.382*2000 = 70000 - 764 = 69236
    // rawResistance = 70000 + 0.382*2000 = 70000 + 764 = 70764
    // minClose (close[1..20]) = 70000, maxClose = 70000
    // support = round(max(70000, 69236)) = 70000
    // resistance = round(min(70000, 70764)) = 70000
    const result = computeSupportResistance(samples);
    expect(result.support).toBe(70000);
    expect(result.resistance).toBe(70000);
  });
});

describe("degradeFields", () => {
  it("returns ok=true and empty missing when all required keys are present", () => {
    const payload = { a: 1, b: "hello", c: true };
    const result = degradeFields(payload, ["a", "b", "c"]);
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("returns ok=false and missing key when one key is null", () => {
    const payload = { a: 1, b: null as string | null, c: true };
    const result = degradeFields(payload, ["a", "b", "c"]);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("b");
  });

  it("returns ok=false and missing key when one key is undefined", () => {
    const payload = { a: 1, b: undefined as string | undefined, c: true };
    const result = degradeFields(payload, ["a", "b", "c"]);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("b");
  });
});
