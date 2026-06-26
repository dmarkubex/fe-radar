import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchGfex } from "../gfex";

const FIXTURES_DIR = join(__dirname, "fixtures");

function makeFixtureFetch(filename: string): typeof fetch {
  const body = readFileSync(join(FIXTURES_DIR, filename), "utf8");
  return async (url: URL | RequestInfo) => {
    if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
    return new Response(body, { status: 200 }) as Response;
  };
}

const OBSERVED_AT = new Date("2026-05-19T08:00:00.000Z");
const CTX = { sourceName: "gfex-test", useRealUa: false };

describe("gfexAdapter", () => {
  describe("正常解析", () => {
    it("从 fixture 中解析碳酸锂主力收盘价与仓单", async () => {
      const fetchImpl = makeFixtureFetch("gfex-20260519.json");
      const samples = await fetchGfex(CTX, OBSERVED_AT, fetchImpl);

      expect(samples).toHaveLength(2);

      const close = samples.find((s) => s.metricKey === "lc_main_close");
      expect(close).toBeDefined();
      // Fixture has lc2507 OI=98450, lc2509 OI=32100 → lc2507 is main contract, close=87400
      expect(close?.value).toBe(87400);
      expect(close?.rawText).toBeTruthy();
      expect(close?.rawText.length).toBeLessThanOrEqual(2000);
      expect(close?.observedAt).toEqual(OBSERVED_AT);
      expect(close?.sourceMetadata).toMatchObject({ exchange: "GFEX" });

      const warrants = samples.find((s) => s.metricKey === "lc_warrants");
      expect(warrants).toBeDefined();
      expect(warrants?.value).toBe(15200);
      expect(warrants?.rawText).toBeTruthy();
      expect(warrants?.sourceMetadata).toMatchObject({ exchange: "GFEX" });
    });

    it("rawText 不含 HTML 标签", async () => {
      const fetchImpl = makeFixtureFetch("gfex-20260519.json");
      const samples = await fetchGfex(CTX, OBSERVED_AT, fetchImpl);
      for (const s of samples) {
        expect(s.rawText).not.toMatch(/<[^>]+>/);
      }
    });
  });

  describe("解析失败 (NFR-102)", () => {
    it("JSON 格式损坏时 value=null 且 rawText 保留", async () => {
      const badBody = "INVALID_JSON { broken";
      const fetchImpl = async (url: string) => {
        if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
        return new Response(badBody, { status: 200 }) as Response;
      };
      const samples = await fetchGfex(CTX, OBSERVED_AT, fetchImpl as typeof fetch);

      expect(samples).toHaveLength(2);
      for (const s of samples) {
        expect(s.value).toBeNull();
        expect(s.rawText).toBe(badBody.trim());
      }
    });

    it("lc product 缺失时 value=null", async () => {
      const body = JSON.stringify({ code: 0, data: { products: [] } });
      const fetchImpl = async (url: string) => {
        if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
        return new Response(body, { status: 200 }) as Response;
      };
      const samples = await fetchGfex(CTX, OBSERVED_AT, fetchImpl as typeof fetch);
      const close = samples.find((s) => s.metricKey === "lc_main_close");
      expect(close?.value).toBeNull();
      expect(close?.rawText).toBeTruthy();
    });
  });

  describe("网络失败", () => {
    it("fetch 抛异常时返回空数组，不传播异常", async () => {
      const fetchImpl = async (url: string): Promise<Response> => {
        if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
        throw new Error("network timeout");
      };
      const samples = await fetchGfex(CTX, OBSERVED_AT, fetchImpl as typeof fetch);
      expect(samples).toEqual([]);
    });
  });

  describe("TLS 设置", () => {
    it("发起请求时 dispatcher 非空（insecureTLS:true 已生效）", async () => {
      let capturedDispatcher: unknown = "NOT_SET";
      const fetchImpl = async (
        url: string,
        init: Record<string, unknown>
      ): Promise<Response> => {
        if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
        capturedDispatcher = init["dispatcher"];
        return new Response(
          JSON.stringify({ code: 0, data: { products: [] } }),
          { status: 200 }
        ) as Response;
      };

      await fetchGfex(CTX, OBSERVED_AT, fetchImpl as typeof fetch);

      expect(capturedDispatcher).not.toBeUndefined();
      expect(capturedDispatcher).not.toBeNull();
    });
  });
});
