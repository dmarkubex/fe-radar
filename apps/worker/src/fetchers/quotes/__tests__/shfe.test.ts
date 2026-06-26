import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchShfe } from "../shfe";

const FIXTURES_DIR = join(__dirname, "fixtures");

function makeFixtureFetch(filename: string): typeof fetch {
  const body = readFileSync(join(FIXTURES_DIR, filename), "utf8");
  return async (url: URL | RequestInfo) => {
    if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
    return new Response(body, { status: 200 }) as Response;
  };
}

const OBSERVED_AT = new Date("2026-05-19T07:30:00.000Z");
const CTX = { sourceName: "shfe-test", useRealUa: false };

describe("shfeAdapter", () => {
  describe("正常解析", () => {
    it("从 fixture 中解析沪铜主力收盘价与仓单", async () => {
      const fetchImpl = makeFixtureFetch("shfe-20260519.dat");
      const samples = await fetchShfe(CTX, OBSERVED_AT, fetchImpl);

      expect(samples).toHaveLength(2);

      const close = samples.find((s) => s.metricKey === "cu_main_close");
      expect(close).toBeDefined();
      expect(close?.value).toBe(78620);
      expect(close?.rawText).toBeTruthy();
      expect(close?.rawText.length).toBeLessThanOrEqual(2000);
      expect(close?.observedAt).toEqual(OBSERVED_AT);
      expect(close?.sourceMetadata).toMatchObject({ exchange: "SHFE" });

      const warrants = samples.find((s) => s.metricKey === "cu_warrants");
      expect(warrants).toBeDefined();
      expect(warrants?.value).toBe(32450);
      expect(warrants?.rawText).toBeTruthy();
      expect(warrants?.sourceMetadata).toMatchObject({ exchange: "SHFE" });
    });

    it("rawText 不含 HTML 标签", async () => {
      const fetchImpl = makeFixtureFetch("shfe-20260519.dat");
      const samples = await fetchShfe(CTX, OBSERVED_AT, fetchImpl);
      for (const s of samples) {
        expect(s.rawText).not.toMatch(/<[^>]+>/);
      }
    });
  });

  describe("解析失败 (NFR-102)", () => {
    it("JSON 格式损坏时返回空数组", async () => {
      const badBody = "NOT_VALID_JSON { broken";
      const fetchImpl = async (url: string) => {
        if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
        return new Response(badBody, { status: 200 }) as Response;
      };
      const samples = await fetchShfe(CTX, OBSERVED_AT, fetchImpl as typeof fetch);

      expect(samples).toEqual([]);
    });

    it("o_curinstrument 空数组时返回空数组", async () => {
      const body = JSON.stringify({ o_curinstrument: [], o_curwarrant: [] });
      const fetchImpl = async (url: string) => {
        if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
        return new Response(body, { status: 200 }) as Response;
      };
      const samples = await fetchShfe(CTX, OBSERVED_AT, fetchImpl as typeof fetch);

      expect(samples).toEqual([]);
    });
  });

  describe("网络失败", () => {
    it("fetch 抛异常时返回空数组，不传播异常", async () => {
      const fetchImpl = async (url: string): Promise<Response> => {
        if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
        throw new Error("network error");
      };
      const samples = await fetchShfe(CTX, OBSERVED_AT, fetchImpl as typeof fetch);
      expect(samples).toEqual([]);
    });
  });

  describe("日期回退", () => {
    it("今天 404 自动回退前一天并命中", async () => {
      const fixtureBody = readFileSync(
        join(FIXTURES_DIR, "shfe-20260519.dat"),
        "utf8"
      );
      const today = new Date("2026-05-20T07:30:00.000Z");
      const fetchImpl = async (url: string): Promise<Response> => {
        if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
        if (url.includes("20260520")) {
          return new Response("Not Found", { status: 404 }) as Response;
        }
        if (url.includes("20260519")) {
          return new Response(fixtureBody, { status: 200 }) as Response;
        }
        return new Response("Not Found", { status: 404 }) as Response;
      };

      const samples = await fetchShfe(CTX, today, fetchImpl as typeof fetch);

      expect(samples).toHaveLength(2);
      const close = samples.find((s) => s.metricKey === "cu_main_close");
      expect(close?.value).toBe(78620);
      expect(close?.observedAt).toEqual(new Date("2026-05-19T07:30:00.000Z"));
      const warrants = samples.find((s) => s.metricKey === "cu_warrants");
      expect(warrants?.value).toBe(32450);
    });

    it("5 天全 404 返回空数组", async () => {
      const fetchImpl = async (url: string): Promise<Response> => {
        if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
        return new Response("Not Found", { status: 404 }) as Response;
      };

      const samples = await fetchShfe(
        CTX,
        new Date("2026-05-20T07:30:00.000Z"),
        fetchImpl as typeof fetch
      );

      expect(samples).toEqual([]);
    });
  });
});
