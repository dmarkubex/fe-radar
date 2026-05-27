import { describe, expect, it, beforeEach } from "vitest";
import { SourceFetchError } from "@fe-radar/shared";
import { fetchAnnouncements, registerAnnouncementAdapter } from "../index";
import type { AnnouncementAdapter } from "../types";
import type { StandardItem } from "../../types";

const SAMPLE: StandardItem = {
  title: "远东股份关于项目中标的公告",
  url: "https://example.com/announcement/1",
  content: "公告摘要",
  publishedAt: new Date("2026-05-20T00:00:00.000Z"),
};

describe("fetchAnnouncements dispatcher", () => {
  const adapterName = "stub-announcement-adapter";

  beforeEach(() => {
    const adapter: AnnouncementAdapter = {
      name: adapterName,
      fetch: async () => [SAMPLE],
    };
    registerAnnouncementAdapter(adapter);
  });

  it("throws FETCH_ADAPTER_UNKNOWN for unregistered adapter name", async () => {
    await expect(
      fetchAnnouncements({ type: "announcement", adapter: "missing-adapter" }, { sourceName: "公告源" })
    ).rejects.toThrow(SourceFetchError);

    await expect(
      fetchAnnouncements({ type: "announcement", adapter: "missing-adapter" }, { sourceName: "公告源" })
    ).rejects.toMatchObject({
      code: "FETCH_ADAPTER_UNKNOWN",
    });
  });

  it("dispatches to the registered adapter and returns StandardItem[]", async () => {
    const items = await fetchAnnouncements(
      { type: "announcement", adapter: adapterName, market: "sse" },
      { sourceName: "公告源" }
    );

    expect(items).toEqual([SAMPLE]);
  });

  it("returns [] when a registered adapter returns empty results", async () => {
    registerAnnouncementAdapter({
      name: "empty-announcement-adapter",
      fetch: async () => [],
    });

    const items = await fetchAnnouncements(
      { type: "announcement", adapter: "empty-announcement-adapter" },
      { sourceName: "空公告源" }
    );

    expect(items).toHaveLength(0);
  });
});
