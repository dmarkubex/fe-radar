import { describe, expect, it, beforeEach } from "vitest";
import { SourceFetchError } from "@fe-radar/shared";
import { fetchQuotes, registerAdapter } from "../index";
import type { QuotesAdapter, QuoteSample } from "../types";

const SAMPLE: QuoteSample = {
  metricKey: "cu_main_close",
  value: 78500,
  observedAt: new Date("2026-05-20T07:00:00.000Z"),
  rawText: "铜主力收盘价 78500 元/吨",
};

const SAMPLE_NULL_VALUE: QuoteSample = {
  metricKey: "cu_main_close",
  value: null,
  observedAt: new Date("2026-05-20T07:00:00.000Z"),
  rawText: "解析失败原始文本",
};

describe("fetchQuotes dispatcher", () => {
  it("throws FETCH_ADAPTER_UNKNOWN for unregistered adapter name", async () => {
    const source = {
      name: "unknown-source",
      config: { adapter: "nonexistent_adapter_xyz" },
    };
    const ctx = { sourceName: "unknown-source" };

    await expect(fetchQuotes(source, ctx)).rejects.toThrow(SourceFetchError);
    await expect(fetchQuotes(source, ctx)).rejects.toMatchObject({
      code: "FETCH_ADAPTER_UNKNOWN",
    });
  });

  it("throws FETCH_ADAPTER_UNKNOWN when adapter field is missing", async () => {
    const source = { name: "no-adapter", config: {} };
    const ctx = { sourceName: "no-adapter" };

    await expect(fetchQuotes(source, ctx)).rejects.toMatchObject({
      code: "FETCH_ADAPTER_UNKNOWN",
    });
  });

  describe("with a registered stub adapter", () => {
    const STUB_ADAPTER_NAME = "stub-test-adapter";

    beforeEach(() => {
      const stubAdapter: QuotesAdapter = {
        name: STUB_ADAPTER_NAME,
        fetch: async (_ctx) => [SAMPLE],
      };
      registerAdapter(stubAdapter);
    });

    it("calls the registered adapter and returns its QuoteSample[]", async () => {
      const source = {
        name: "stub-source",
        config: { adapter: STUB_ADAPTER_NAME, metric_keys: ["cu_main_close"] },
      };
      const ctx = { sourceName: "stub-source" };

      const results = await fetchQuotes(source, ctx);

      expect(results).toHaveLength(1);
      expect(results[0]).toBeDefined();
      expect(results[0]).toMatchObject({
        metricKey: "cu_main_close",
        value: 78500,
        rawText: "铜主力收盘价 78500 元/吨",
      });
    });

    it("passes source config into the adapter context", async () => {
      let seenConfig: Record<string, unknown> | undefined;
      const configAwareAdapter: QuotesAdapter = {
        name: "config-aware-adapter",
        fetch: async (adapterCtx) => {
          seenConfig = adapterCtx.sourceConfig;
          return [SAMPLE];
        },
      };
      registerAdapter(configAwareAdapter);

      const source = {
        name: "config-source",
        config: {
          adapter: "config-aware-adapter",
          endpoint: "https://example.com/quotes",
          metric_keys: ["cu_main_close"],
        },
      };

      await fetchQuotes(source, { sourceName: "config-source" });
      expect(seenConfig).toMatchObject({
        adapter: "config-aware-adapter",
        endpoint: "https://example.com/quotes",
        metric_keys: ["cu_main_close"],
      });
    });

    it("returns [] when a registered adapter returns empty array", async () => {
      const emptyAdapter: QuotesAdapter = {
        name: "empty-test-adapter",
        fetch: async (_ctx) => [],
      };
      registerAdapter(emptyAdapter);

      const source = {
        name: "empty-source",
        config: { adapter: "empty-test-adapter" },
      };
      const ctx = { sourceName: "empty-source" };

      const results = await fetchQuotes(source, ctx);
      expect(results).toHaveLength(0);
    });

    it("adapter may return QuoteSample with value=null (NFR-102 parse failure path)", async () => {
      const nullValueAdapter: QuotesAdapter = {
        name: "null-value-adapter",
        fetch: async (_ctx) => [SAMPLE_NULL_VALUE],
      };
      registerAdapter(nullValueAdapter);

      const source = {
        name: "null-source",
        config: { adapter: "null-value-adapter" },
      };
      const ctx = { sourceName: "null-source" };

      const results = await fetchQuotes(source, ctx);
      expect(results).toHaveLength(1);
      const first = results[0];
      expect(first?.value).toBeNull();
      expect(first?.rawText).toBe("解析失败原始文本");
    });
  });
});

// Compile-time type shape assertions (no runtime assertions needed)
describe("QuoteSample type shape", () => {
  it("accepts all valid field combinations", () => {
    const minimal: QuoteSample = {
      metricKey: "lc_main_close",
      value: 63000,
      observedAt: new Date(),
      rawText: "碳酸锂收盘价",
    };
    expect(minimal.metricKey).toBe("lc_main_close");
    expect(minimal.sourceMetadata).toBeUndefined();

    const full: QuoteSample = {
      metricKey: "lc_main_close",
      value: null,
      observedAt: new Date(),
      rawText: "解析失败",
      sourceMetadata: { exchange: "GFEX", contract: "LC2507" },
    };
    const meta = full.sourceMetadata;
    expect(meta).toEqual({ exchange: "GFEX", contract: "LC2507" });
  });
});
