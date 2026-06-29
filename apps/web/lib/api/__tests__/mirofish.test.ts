import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMirofishSeedMarkdown,
  buildMirofishSeedPayload,
  createMirofishProjectFromItem
} from "@/lib/api/mirofish";

import type { ItemDetailDto } from "@/lib/api/timeline-query";

function itemFixture(): ItemDetailDto {
  return {
    id: 42,
    title: "铜价波动带动线缆企业成本关注",
    url: "https://example.com/item",
    displayUrl: "https://example.com/item",
    sourceName: "测试信源",
    sourceTier: "T1",
    sourceCategory: "commodity",
    sourceFetcherType: "rss",
    acquisitionLabel: null,
    publishedAt: "2026-06-29T00:00:00.000Z",
    scoredAt: "2026-06-29T01:00:00.000Z",
    summaryZh: "铜价波动影响线缆企业成本。",
    category: "原料",
    topCircle: "C2",
    qualityScore: 72,
    alertType: null,
    alertLevel: null,
    clusterId: 7,
    eventType: "市场",
    relatedCount: 1,
    content: "原文内容",
    translationZh: null,
    scores: {
      d1Policy: 10,
      d2Chain: 80,
      d3Market: 90,
      d4Tech: 20,
      d5Business: 70
    },
    entities: [{ id: 1, type: "company", canonicalName: "远东", circle: "C1", span: "远东" }],
    clusterItems: [
      {
        id: 43,
        title: "关联条目",
        url: "https://example.com/related",
        displayUrl: "https://example.com/related",
        sourceName: "关联信源",
        sourceFetcherType: "rss",
        acquisitionLabel: null,
        publishedAt: "2026-06-29T02:00:00.000Z",
        similarity: 0.8,
        summaryZh: "关联条目摘要：下游需求回暖。"
      }
    ]
  };
}

const envSnapshot = {
  apiBaseUrl: process.env["MIROFISH_API_BASE_URL"],
  webBaseUrl: process.env["MIROFISH_WEB_BASE_URL"],
  timeoutMs: process.env["MIROFISH_REQUEST_TIMEOUT_MS"],
  enabled: process.env["MIROFISH_ENABLED"]
};

describe("buildMirofishSeedMarkdown", () => {
  beforeEach(() => {
    process.env["MIROFISH_API_BASE_URL"] = "http://mirofish-api";
    process.env["MIROFISH_WEB_BASE_URL"] = "http://mirofish-web";
    process.env["MIROFISH_REQUEST_TIMEOUT_MS"] = "1000";
    delete process.env["MIROFISH_ENABLED"];
  });

  afterEach(() => {
    if (envSnapshot.apiBaseUrl === undefined) {
      delete process.env["MIROFISH_API_BASE_URL"];
    } else {
      process.env["MIROFISH_API_BASE_URL"] = envSnapshot.apiBaseUrl;
    }
    if (envSnapshot.webBaseUrl === undefined) {
      delete process.env["MIROFISH_WEB_BASE_URL"];
    } else {
      process.env["MIROFISH_WEB_BASE_URL"] = envSnapshot.webBaseUrl;
    }
    if (envSnapshot.timeoutMs === undefined) {
      delete process.env["MIROFISH_REQUEST_TIMEOUT_MS"];
    } else {
      process.env["MIROFISH_REQUEST_TIMEOUT_MS"] = envSnapshot.timeoutMs;
    }
    if (envSnapshot.enabled === undefined) {
      delete process.env["MIROFISH_ENABLED"];
    } else {
      process.env["MIROFISH_ENABLED"] = envSnapshot.enabled;
    }
    vi.unstubAllGlobals();
  });

  it("builds a seed document with related context and no future price ask", () => {
    const markdown = buildMirofishSeedMarkdown(itemFixture());

    expect(markdown).toContain("# FE-Radar 情报预测种子");
    expect(markdown).toContain("关联条目");
    expect(markdown).toContain("摘要：关联条目摘要：下游需求回暖。");
    expect(markdown).toContain("不要给出具体未来价格数值");
    expect(markdown).toContain("D3 市场价格");
  });

  it("builds a JSON seed payload with trace metadata", () => {
    const payload = buildMirofishSeedPayload(itemFixture());

    expect(payload.project_name).toContain("FE-Radar #42");
    expect(payload.documents).toHaveLength(1);
    expect(payload.documents[0]?.filename).toBe("fe-radar-item-42.md");
    expect(payload.documents[0]?.content).toContain("# FE-Radar 情报预测种子");
    expect(payload.documents[0]?.source_url).toBe("https://example.com/item");
    expect(payload.metadata).toMatchObject({
      source_system: "fe-radar",
      item_id: 42,
      source_name: "测试信源",
      source_tier: "T1",
      related_count: 1
    });
  });

  it("posts the seed payload to MiroFish external JSON API", async () => {
    const fetchMock = vi.fn<(
      input: RequestInfo | URL,
      init?: RequestInit
    ) => Promise<Response>>(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            project_id: "proj_123",
            project_name: "FE-Radar #42 铜价波动"
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const project = await createMirofishProjectFromItem(itemFixture());

    expect(project).toEqual({
      projectId: "proj_123",
      projectUrl: "http://mirofish-web/process/proj_123"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://mirofish-api/api/external/seed",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" }
      })
    );

    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(requestInit).toBeDefined();
    if (!requestInit) {
      throw new Error("missing fetch request init");
    }
    const body = JSON.parse(String(requestInit.body));
    expect(body.documents[0].filename).toBe("fe-radar-item-42.md");
    expect(body.documents[0].content).toContain("铜价波动影响线缆企业成本");
    expect(body.metadata.item_id).toBe(42);
  });
});
