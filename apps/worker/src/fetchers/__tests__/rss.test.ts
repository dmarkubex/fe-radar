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

  // keywordFilter 语义与 html.ts 一致：title + content 命中任一关键词（大小写敏感）才保留。
  it("keeps only items whose title or content contains a keywordFilter keyword", async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
      <item><title>电缆招标公告</title><link>https://example.com/a</link><description>某项目</description></item>
      <item><title>娱乐新闻</title><link>https://example.com/b</link><description>明星动态</description></item>
      <item><title>普通新闻</title><link>https://example.com/c</link><description>涉及储能产业链</description></item>
    </channel></rss>`;
    const fetchImpl = async (url: string) =>
      url.endsWith("/robots.txt") ? new Response("") : new Response(xml);

    const items = await fetchRss(
      { type: "rss", url: "https://example.com/rss.xml", keywordFilter: ["电缆", "储能"] },
      { sourceName: "filtered" },
      fetchImpl as typeof fetch
    );
    expect(items.map((item) => item.url)).toEqual([
      "https://example.com/a",
      "https://example.com/c"
    ]);
  });

  it("keywordFilter matching is case-sensitive", async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
      <item><title>CABLE news</title><link>https://example.com/a</link><description>upper</description></item>
      <item><title>cable news</title><link>https://example.com/b</link><description>lower</description></item>
    </channel></rss>`;
    const fetchImpl = async (url: string) =>
      url.endsWith("/robots.txt") ? new Response("") : new Response(xml);

    const items = await fetchRss(
      { type: "rss", url: "https://example.com/rss.xml", keywordFilter: ["cable"] },
      { sourceName: "case" },
      fetchImpl as typeof fetch
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe("https://example.com/b");
  });

  it("returns [] without throwing when keywordFilter removes every item", async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
      <item><title>娱乐新闻</title><link>https://example.com/a</link><description>明星</description></item>
    </channel></rss>`;
    const fetchImpl = async (url: string) =>
      url.endsWith("/robots.txt") ? new Response("") : new Response(xml);

    const items = await fetchRss(
      { type: "rss", url: "https://example.com/rss.xml", keywordFilter: ["电缆"] },
      { sourceName: "all-filtered" },
      fetchImpl as typeof fetch
    );
    expect(items).toEqual([]);
  });

  // 回代：0042 给 36氪快讯等生产 rss 源配的真实 keywordFilter。feed 非空但本轮
  // 标题/内容都不命中行业词 → 修复前抛 FETCH_RSS_EMPTY（计入 fail_count），
  // 修复后返回 []，不会抛出 SourceFetchError。
  it("does not throw a fail_count error when a non-empty 36kr-style feed misses every keyword", async () => {
    const keywordFilter = [
      "电力",
      "电网",
      "电缆",
      "电线",
      "输配电",
      "特高压",
      "变压器",
      "储能",
      "能源",
      "光伏",
      "风电",
      "新能源",
      "锂电",
      "锂电池",
      "碳酸锂",
      "铜",
      "有色",
      "稀土",
      "充电桩",
      "电池",
      "电工",
      "远东",
      "光纤",
      "光缆",
      "光通信",
      "光模块",
      "OPGW",
      "ADSS"
    ];
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>36氪快讯</title>
      <item><title>美联储加息预期升温</title><link>https://36kr.com/a</link><description>美元指数走强，非农数据超预期</description></item>
      <item><title>某明星代言新款手机发布</title><link>https://36kr.com/b</link><description>消费电子发布会花絮与票房讨论</description></item>
      <item><title>沪指收涨0.5%，北向资金净流入</title><link>https://36kr.com/c</link><description>两市成交额回升，券商板块领涨</description></item>
    </channel></rss>`;
    const fetchImpl = async (url: string) =>
      url.endsWith("/robots.txt") ? new Response("") : new Response(xml);

    await expect(
      fetchRss(
        { type: "rss", url: "https://36kr.com/feed", keywordFilter },
        { sourceName: "36氪快讯" },
        fetchImpl as typeof fetch
      )
    ).resolves.toEqual([]);

    await expect(
      fetchRss(
        { type: "rss", url: "https://36kr.com/feed", keywordFilter },
        { sourceName: "36氪快讯" },
        fetchImpl as typeof fetch
      )
    ).resolves.not.toBeInstanceOf(SourceFetchError);
  });
});
