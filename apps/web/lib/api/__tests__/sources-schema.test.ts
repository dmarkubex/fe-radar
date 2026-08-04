import { describe, expect, it } from "vitest";
import { createSourceSchema } from "../sources-schema";

const endpoint = "https://ecp.sgcc.com.cn/ecp2.0/ecpwcmcore/index/noteList";
const source = (overrides: Record<string, unknown> = {}) => ({
  name: "国家电网公开招采",
  url: "https://ecp.sgcc.com.cn/ecp2.0/portal/",
  fetcherType: "announcement",
  config: {
    type: "announcement",
    adapter: "sgcc-tender",
    endpoint,
    keywords: ["电缆", "储能"],
    noticeKinds: ["tender", "result"],
    pageSize: 20,
    gate0: {
      domains: ["downstream", "products"],
      signalKinds: ["tender"],
      maxAgeHours: 168
    },
    ...overrides
  },
  tier: "T1",
  category: "央企招采",
  enabled: false
});

describe("sources schema Gate 0", () => {
  it("accepts a valid SGCC tender source", () => {
    expect(createSourceSchema.safeParse(source()).success).toBe(true);
  });

  it("accepts the allowlisted PowerChina and CHN Energy adapters", () => {
    expect(
      createSourceSchema.safeParse(
        source({
          adapter: "powerchina-tender",
          endpoint:
            "https://bid.powerchina.cn/newcbs/recpro-newmember/BidAnnouncementSummary/list"
        })
      ).success
    ).toBe(true);
    expect(
      createSourceSchema.safeParse(
        source({
          adapter: "chnenergy-tender",
          endpoint: "https://www.chnenergybidding.com.cn/bidweb/"
        })
      ).success
    ).toBe(true);
  });

  it("accepts the allowlisted fourth-batch official JSON adapters", () => {
    expect(
      createSourceSchema.safeParse(
        source({
          adapter: "nexans-news",
          endpoint:
            "https://www.nexans.com/ajax.php?action=last_posts&cpt_slug=documents&wpml_lang=en&page=1&tag_to_display=document_types",
          keywords: undefined,
          noticeKinds: undefined
        })
      ).success
    ).toBe(true);
    expect(
      createSourceSchema.safeParse(
        source({
          adapter: "huawei-digital-power-news",
          endpoint:
            "https://digitalpower.huawei.com/service/portalapplication/v1/digitalpower/news",
          searchkey: "ESS",
          contentId: "48e0a5ce972c4e4aa847fd0e1b127b19",
          pageSize: 50,
          keywords: undefined,
          noticeKinds: undefined
        })
      ).success
    ).toBe(true);
  });

  it("rejects hostile fourth-batch official JSON endpoints", () => {
    expect(
      createSourceSchema.safeParse(
        source({
          adapter: "nexans-news",
          endpoint:
            "https://evil.example/ajax.php?action=last_posts&cpt_slug=documents&wpml_lang=en&page=1&tag_to_display=document_types",
          keywords: undefined,
          noticeKinds: undefined
        })
      ).success
    ).toBe(false);
    expect(
      createSourceSchema.safeParse(
        source({
          adapter: "huawei-digital-power-news",
          endpoint:
            "https://digitalpower.huawei.com/service/portalapplication/v1/digitalpower/news",
          searchkey: "ESS",
          contentId: "bad",
          keywords: undefined,
          noticeKinds: undefined
        })
      ).success
    ).toBe(false);
  });

  it("rejects hostile endpoints and missing required fields", () => {
    expect(
      createSourceSchema.safeParse(
        source({
          endpoint: "https://evil.example/ecp2.0/ecpwcmcore/index/noteList"
        })
      ).success
    ).toBe(false);
    expect(createSourceSchema.safeParse(source({ keywords: [] })).success).toBe(
      false
    );
    expect(
      createSourceSchema.safeParse(source({ noticeKinds: [] })).success
    ).toBe(false);
  });

  it("rejects SGCC page sizes above 20 and duplicate Gate 0 values", () => {
    expect(createSourceSchema.safeParse(source({ pageSize: 21 })).success).toBe(
      false
    );
    expect(
      createSourceSchema.safeParse(
        source({
          gate0: {
            domains: ["downstream", "downstream"],
            signalKinds: ["tender"],
            maxAgeHours: 168
          }
        })
      ).success
    ).toBe(false);
  });

  it("keeps Gate 0 optional for existing RSS sources", () => {
    expect(
      createSourceSchema.safeParse({
        name: "RSS",
        url: "https://example.com/feed.xml",
        fetcherType: "rss",
        config: { type: "rss", url: "https://example.com/feed.xml" },
        tier: "T2",
        enabled: true
      }).success
    ).toBe(true);
  });

  it("accepts the keyless USD/CNY quotes adapter", () => {
    expect(
      createSourceSchema.safeParse({
        name: "Exchange API USD/CNY",
        url: "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
        fetcherType: "quotes",
        config: {
          type: "quotes",
          adapter: "exchange-api",
          metric_keys: ["fx_usdcny"],
          endpoint:
            "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
          retry: { max: 3, backoffMs: 1500 }
        },
        tier: "T2",
        category: "市场数据",
        enabled: false
      }).success
    ).toBe(true);
    expect(
      createSourceSchema.safeParse({
        name: "Bad Exchange API",
        url: "https://example.com/latest/USD",
        fetcherType: "quotes",
        config: {
          type: "quotes",
          adapter: "exchange-api",
          metric_keys: ["fx_usdcny"],
          endpoint: "https://example.com/latest/USD",
          retry: { max: 3, backoffMs: 1500 }
        },
        tier: "T2",
        category: "市场数据",
        enabled: false
      }).success
    ).toBe(false);
  });
});
