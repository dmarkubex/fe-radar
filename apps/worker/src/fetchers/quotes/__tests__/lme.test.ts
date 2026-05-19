import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchLme } from "../lme";

const FIXTURES_DIR = join(__dirname, "fixtures");

function makeFixtureFetch(filename: string): typeof fetch {
  const body = readFileSync(join(FIXTURES_DIR, filename), "utf8");
  return async (url: URL | RequestInfo) => {
    if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
    return new Response(body, { status: 200 }) as Response;
  };
}

const OBSERVED_AT = new Date("2026-05-19T12:00:00.000Z");
const CTX = { sourceName: "lme-test", useRealUa: false };

describe("lmeAdapter", () => {
  describe("正常解析", () => {
    it("从 fixture HTML 中解析伦铜 3 个月合约卖价", async () => {
      const fetchImpl = makeFixtureFetch("lme-20260519.html");
      const samples = await fetchLme(CTX, OBSERVED_AT, fetchImpl);

      expect(samples).toHaveLength(1);

      const sample = samples[0];
      expect(sample?.metricKey).toBe("lme_cu_3m");
      // Fixture: 3-months Seller = 9549.50
      expect(sample?.value).toBe(9549.5);
      expect(sample?.rawText).toBeTruthy();
      expect(sample?.rawText.length).toBeLessThanOrEqual(2000);
      expect(sample?.observedAt).toEqual(OBSERVED_AT);
      expect(sample?.sourceMetadata).toMatchObject({ exchange: "LME", contract: "3M" });
    });

    it("rawText 不含 HTML 标签", async () => {
      const fetchImpl = makeFixtureFetch("lme-20260519.html");
      const samples = await fetchLme(CTX, OBSERVED_AT, fetchImpl);
      for (const s of samples) {
        expect(s.rawText).not.toMatch(/<[^>]+>/);
      }
    });
  });

  describe("解析失败 (NFR-102)", () => {
    it("Copper 行不存在时 value=null 且 rawText 保留", async () => {
      const noCopper = `<!DOCTYPE html><html><body><table><tbody><tr><td>Aluminium</td><td>20 May 2026</td><td>2420</td><td>2421</td><td>2435</td><td>2436</td></tr></tbody></table></body></html>`;
      const fetchImpl = async (url: string) => {
        if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
        return new Response(noCopper, { status: 200 }) as Response;
      };
      const samples = await fetchLme(CTX, OBSERVED_AT, fetchImpl as typeof fetch);

      expect(samples).toHaveLength(1);
      expect(samples[0]?.value).toBeNull();
      expect(samples[0]?.rawText).toBeTruthy();
      expect(samples[0]?.rawText).not.toMatch(/<[^>]+>/);
    });

    it("价格单元格为空时 value=null", async () => {
      const emptyCells = `<!DOCTYPE html><html><body><table><tbody><tr data-metal="copper"><td>Copper</td><td>20 May 2026</td><td></td><td></td><td></td><td class="three-month-seller"></td></tr></tbody></table></body></html>`;
      const fetchImpl = async (url: string) => {
        if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
        return new Response(emptyCells, { status: 200 }) as Response;
      };
      const samples = await fetchLme(CTX, OBSERVED_AT, fetchImpl as typeof fetch);
      expect(samples[0]?.value).toBeNull();
    });
  });

  describe("网络失败", () => {
    it("fetch 抛异常时返回空数组，不传播异常", async () => {
      const fetchImpl = async (url: string): Promise<Response> => {
        if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
        throw new Error("connection refused");
      };
      const samples = await fetchLme(CTX, OBSERVED_AT, fetchImpl as typeof fetch);
      expect(samples).toEqual([]);
    });
  });
});
