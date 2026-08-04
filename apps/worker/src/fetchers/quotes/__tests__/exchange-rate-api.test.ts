import { beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeRateApiAdapter } from "../exchange-rate-api";

vi.mock("../../http", () => ({ fetchTextWithPolicy: vi.fn() }));

import { fetchTextWithPolicy } from "../../http";

const mockFetch = vi.mocked(fetchTextWithPolicy);

describe("exchangeRateApiAdapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses the same-day USD/CNY quote and rejects invalid endpoints", async () => {
    mockFetch.mockResolvedValueOnce(
      JSON.stringify({
        date: "2026-08-04",
        usd: { cny: 6.7526 },
      }),
    );

    const samples = await exchangeRateApiAdapter.fetch({
      sourceName: "Exchange API USD/CNY",
      sourceConfig: {
        endpoint:
          "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
      },
    });
    expect(samples).toEqual([
      expect.objectContaining({
        metricKey: "fx_usdcny",
        value: 6.7526,
        observedAt: new Date("2026-08-03T16:00:00.000Z"),
      }),
    ]);
    expect(
      await exchangeRateApiAdapter.fetch({
        sourceName: "invalid",
        sourceConfig: { endpoint: "http://127.0.0.1/latest/USD" },
      }),
    ).toEqual([]);
    mockFetch.mockResolvedValueOnce(
      JSON.stringify({ date: "2026-02-30", usd: { cny: 6.7526 } }),
    );
    expect(
      await exchangeRateApiAdapter.fetch({
        sourceName: "invalid-date",
        sourceConfig: {
          endpoint:
            "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
        },
      }),
    ).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
