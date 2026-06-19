import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchSmmHq, smmHqAdapter } from "../smm-hq";

const FIXTURES_DIR = join(__dirname, "fixtures");
const OBSERVED_AT = new Date("2026-06-18T07:30:00.000Z");

function fixtureFetch(filename: string): typeof fetch {
  const body = readFileSync(join(FIXTURES_DIR, filename), "utf8");
  return async (url: URL | RequestInfo) => {
    if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
    return new Response(body, { status: 200 }) as Response;
  };
}

describe("smmHqAdapter", () => {
  it("has correct name", () => {
    expect(smmHqAdapter.name).toBe("smm-hq");
  });

  it("extracts SMM copper main and spot aliases from Next data", async () => {
    const samples = await fetchSmmHq(
      {
        sourceName: "SMM 铜行情",
        sourceConfig: {
          endpoint: "https://hq.smm.cn/h5/cu",
          items: [
            {
              kind: "instrument",
              metric_key: "cu_main_close",
              column_no: "CUP01",
              instrument_id: "cu0000",
              value_field: "LastPrice",
            },
            {
              kind: "product",
              metric_key: "cu_spot_smm",
              column_no: "CUP02",
              product_id: "201102250376",
              product_name: "上海今日铜价",
            },
          ],
        },
      },
      OBSERVED_AT,
      fixtureFetch("smm-hq-cu.html")
    );

    expect(samples.find((sample) => sample.metricKey === "cu_main_close")?.value).toBe(104780);
    expect(samples.find((sample) => sample.metricKey === "cu_spot_smm")?.value).toBe(104885);
    expect(samples.every((sample) => !sample.rawText.includes("<"))).toBe(true);
    expect(samples.every((sample) => Array.from(sample.rawText).length <= 2000)).toBe(true);
  });

  it("extracts SMM lithium as both lc_main_close and lc_spot_smm", async () => {
    const samples = await fetchSmmHq(
      {
        sourceName: "SMM 碳酸锂行情",
        sourceConfig: {
          endpoint: "https://hq.smm.cn/h5/Li2CO3",
          items: [
            {
              kind: "product",
              metric_key: "lc_main_close",
              emit_metric_keys: ["lc_spot_smm"],
              column_no: "LCP02",
              product_id: "201102250059",
              product_name: "电池级碳酸锂价格",
            },
          ],
        },
      },
      OBSERVED_AT,
      fixtureFetch("smm-hq-li2co3.html")
    );

    expect(samples).toHaveLength(2);
    expect(samples.find((sample) => sample.metricKey === "lc_main_close")?.value).toBe(167250);
    expect(samples.find((sample) => sample.metricKey === "lc_spot_smm")?.value).toBe(167250);
  });

  it("emits null samples when configured product is not found", async () => {
    const samples = await fetchSmmHq(
      {
        sourceName: "SMM missing",
        sourceConfig: {
          endpoint: "https://hq.smm.cn/h5/Li2CO3",
          items: [
            {
              kind: "product",
              metric_key: "missing_metric",
              column_no: "LCP02",
              product_id: "missing",
            },
          ],
        },
      },
      OBSERVED_AT,
      fixtureFetch("smm-hq-li2co3.html")
    );

    expect(samples).toHaveLength(1);
    expect(samples[0]?.metricKey).toBe("missing_metric");
    expect(samples[0]?.value).toBeNull();
    expect(samples[0]?.rawText).toBeTruthy();
  });

  it("returns [] when fetch fails", async () => {
    const fetchImpl = async (url: string): Promise<Response> => {
      if (String(url).endsWith("/robots.txt")) return new Response("") as Response;
      throw new Error("network");
    };

    const samples = await fetchSmmHq(
      {
        sourceName: "SMM down",
        sourceConfig: {
          endpoint: "https://hq.smm.cn/h5/cu",
          metric_keys: ["cu_main_close"],
        },
      },
      OBSERVED_AT,
      fetchImpl as typeof fetch
    );

    expect(samples).toEqual([]);
  });
});
