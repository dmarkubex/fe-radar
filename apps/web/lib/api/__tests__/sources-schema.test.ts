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
});
