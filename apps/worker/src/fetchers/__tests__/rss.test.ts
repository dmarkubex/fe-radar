import { describe, expect, it } from "vitest";
import { SourceFetchError } from "@fe-radar/shared";
import { fetchRss } from "../rss";

describe("rss fetcher", () => {
  it("maps rss items to standard items", async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title><item><title>A</title><link>https://example.com/a</link><pubDate>Mon, 11 May 2026 00:00:00 GMT</pubDate><description>Content</description></item></channel></rss>`;
    const fetchImpl = async (url: string) => url.endsWith("/robots.txt") ? new Response("") : new Response(xml);
    const items = await fetchRss({ type: "rss", url: "https://example.com/rss.xml" }, { sourceName: "test" }, fetchImpl as typeof fetch);
    expect(items[0]).toMatchObject({ title: "A", url: "https://example.com/a" });
  });

  // T-SEC-07: 恶意 / 被劫持 RSS feed 发超大响应，必须在 parser 前被 maxResponseBytes 截断。
  it("rejects oversized responses before parsing (maxResponseBytes)", async () => {
    const huge = "x".repeat(3 * 1024 * 1024); // 3MB > default 2MB cap
    const fetchImpl = async (url: string) => url.endsWith("/robots.txt")
      ? new Response("")
      : new Response(huge, { headers: { "content-length": String(huge.length) } });
    await expect(
      fetchRss({ type: "rss", url: "https://example.com/rss.xml" }, { sourceName: "test" }, fetchImpl as typeof fetch)
    ).rejects.toThrowError(/exceeds configured size limit|FETCH_RESPONSE_TOO_LARGE/);
    // ensure SourceFetchError so the retry loop treats it as non-retryable
    await expect(
      fetchRss({ type: "rss", url: "https://example.com/rss.xml" }, { sourceName: "test" }, fetchImpl as typeof fetch)
    ).rejects.toBeInstanceOf(SourceFetchError);
  });

  // Skip single bad items (align sse "skips malformed records while keeping valid ones").
  it("skips one item missing link among 30 and returns the rest without throwing", async () => {
    const goodItems = Array.from({ length: 29 }, (_, i) =>
      `<item><title>T${i}</title><link>https://example.com/${i}</link><description>c</description></item>`
    ).join("");
    const badItem = `<item><title>NoLink</title><description>missing link</description></item>`;
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${goodItems}${badItem}</channel></rss>`;
    const fetchImpl = async (url: string) =>
      url.endsWith("/robots.txt") ? new Response("") : new Response(xml);

    const items = await fetchRss(
      { type: "rss", url: "https://example.com/rss.xml" },
      { sourceName: "partial-feed" },
      fetchImpl as typeof fetch
    );
    expect(items).toHaveLength(29);
    expect(items.every((item) => item.url.startsWith("https://example.com/"))).toBe(true);
    expect(items.some((item) => item.title === "NoLink")).toBe(false);
  });

  it("throws FETCH_RSS_INVALID when every item is missing title or link", async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
      <item><title>OnlyTitle</title><description>x</description></item>
      <item><link>https://example.com/no-title</link><description>y</description></item>
    </channel></rss>`;
    const fetchImpl = async (url: string) =>
      url.endsWith("/robots.txt") ? new Response("") : new Response(xml);

    await expect(
      fetchRss(
        { type: "rss", url: "https://example.com/rss.xml" },
        { sourceName: "all-bad" },
        fetchImpl as typeof fetch
      )
    ).rejects.toMatchObject({ code: "FETCH_RSS_INVALID" });
  });
});
