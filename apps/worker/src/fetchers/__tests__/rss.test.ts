import { describe, expect, it } from "vitest";
import { fetchRss } from "../rss";

describe("rss fetcher", () => {
  it("maps rss items to standard items", async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title><item><title>A</title><link>https://example.com/a</link><pubDate>Mon, 11 May 2026 00:00:00 GMT</pubDate><description>Content</description></item></channel></rss>`;
    const fetchImpl = async (url: string) => url.endsWith("/robots.txt") ? new Response("") : new Response(xml);
    const items = await fetchRss({ type: "rss", url: "https://example.com/rss.xml" }, { sourceName: "test" }, fetchImpl as typeof fetch);
    expect(items[0]).toMatchObject({ title: "A", url: "https://example.com/a" });
  });
});
