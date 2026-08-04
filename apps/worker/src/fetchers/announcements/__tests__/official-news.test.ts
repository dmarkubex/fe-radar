import { describe, expect, it } from "vitest";
import type { AnnouncementSourceConfig } from "../../types";
import {
  mapHuaweiResponse,
  mapNexansResponse,
  resolveHuaweiEndpoint,
  resolveNexansEndpoint
} from "../official-news";

describe("official news adapters", () => {
  it("maps Nexans descriptions and day-first English dates", () => {
    const items = mapNexansResponse({
      success: true,
      data: {
        list: [
          {
            title: "Subsea cable &amp; grid project",
            post_date: "09 July 2026",
            post_link: "https://www.nexans.com/press-releases/example/",
            tag_to_display: ["Projects"],
            fields: { description: "High-voltage submarine cable delivery" }
          }
        ]
      }
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Subsea cable & grid project",
      url: "https://www.nexans.com/press-releases/example/"
    });
    expect(items[0]!.content).toContain("submarine cable delivery Projects");
    expect(items[0]!.publishedAt.toISOString()).toBe(
      "2026-07-08T16:00:00.000Z"
    );
  });

  it("keeps only Huawei storage results from broad ESS search", () => {
    const items = mapHuaweiResponse({
      code: 200,
      data: {
        results: [
          {
            title: "Huawei launches grid-forming ESS platform",
            description: "A utility energy storage system",
            releaseFormatTime: "Jul 23, 2026",
            pageUrl: "digitalpower.huawei.com/en/news/fusionsolar/ess.html"
          },
          {
            title: "Data center ecosystem forum",
            description: "Power and cooling solutions",
            releaseFormatTime: "Jul 20, 2026",
            pageUrl: "digitalpower.huawei.com/en/news/datacenter/forum.html"
          }
        ]
      }
    });

    expect(items).toHaveLength(1);
    expect(items[0]!.title).toContain("ESS platform");
    expect(items[0]!.publishedAt.toISOString()).toBe(
      "2026-07-22T16:00:00.000Z"
    );
  });

  it("rejects endpoints outside the two exact official API routes", () => {
    const config = (adapter: string, endpoint: string) =>
      ({ type: "announcement", adapter, endpoint }) as AnnouncementSourceConfig;

    expect(() =>
      resolveNexansEndpoint(
        config("nexans-news", "https://example.com/ajax.php")
      )
    ).toThrow(/allowlisted/);
    expect(() =>
      resolveHuaweiEndpoint(
        config(
          "huawei-digital-power-news",
          "https://digitalpower.huawei.com/service/other"
        )
      )
    ).toThrow(/allowlisted/);
  });
});
