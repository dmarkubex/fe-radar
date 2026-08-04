import { fetchTextWithPolicy } from "../http";
import type { FetchContext } from "../types";
import type { QuotesAdapter, QuoteSample } from "./types";

const DEFAULT_ENDPOINT =
  "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json";

export const exchangeRateApiAdapter: QuotesAdapter = {
  name: "exchange-api",

  async fetch(ctx: FetchContext): Promise<QuoteSample[]> {
    const endpoint =
      (ctx.sourceConfig?.["endpoint"] as string | undefined) ?? DEFAULT_ENDPOINT;

    try {
      const url = new URL(endpoint);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "latest.currency-api.pages.dev" ||
        url.port !== "" ||
        url.username !== "" ||
        url.password !== "" ||
        url.pathname !== "/v1/currencies/usd.min.json" ||
        url.search !== "" ||
        url.hash !== ""
      ) {
        return [];
      }

      const raw = await fetchTextWithPolicy(url.toString(), {
        timeoutMs: 8000,
        useRealUa: ctx.useRealUa ?? true,
        maxResponseBytes: 100_000,
        source: ctx.sourceName,
      });
      const payload = JSON.parse(raw) as {
        date?: string;
        usd?: { cny?: number };
      };
      const value = payload.usd?.cny;
      const quoteDate = payload.date;
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value <= 0 ||
        typeof quoteDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(quoteDate)
      ) {
        return [];
      }

      const observedAt = new Date(`${quoteDate}T00:00:00+08:00`);
      const normalizedDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(observedAt);
      if (Number.isNaN(observedAt.getTime()) || normalizedDate !== quoteDate) {
        return [];
      }

      return [
        {
          metricKey: "fx_usdcny",
          value,
          observedAt,
          rawText: JSON.stringify({
            provider: "fawazahmed0/exchange-api",
            date: quoteDate,
            base: "USD",
            quote: "CNY",
            value,
          }),
          sourceMetadata: {
            provider: "https://github.com/fawazahmed0/exchange-api",
          },
        },
      ];
    } catch {
      return [];
    }
  },
};
