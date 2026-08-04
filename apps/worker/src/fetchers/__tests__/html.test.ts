import { describe, expect, it } from "vitest";
import { fetchHtml, parsePublishedAt } from "../html";

describe("html fetcher", () => {
  it("extracts configured selectors without storing raw html", async () => {
    const html = `<ul><li class="item"><a class="title" href="/a">新闻 A</a><span class="date">2026-05-11</span></li></ul>`;
    const fetchImpl = async (url: string) =>
      url.endsWith("/robots.txt") ? new Response("") : new Response(html);
    const items = await fetchHtml(
      {
        type: "html",
        listUrl: "https://example.com/news/",
        selectors: {
          item: ".item",
          title: ".title",
          link: ".title",
          date: ".date",
          content: ".title"
        }
      },
      { sourceName: "test" },
      fetchImpl as typeof fetch
    );
    expect(items[0]?.content).toBe("新闻 A");
    expect(items[0]?.url).toBe("https://example.com/a");
  });

  it("matches title and link selectors on anchor items themselves", async () => {
    const html = `<div class="xNews_left">
      <a href="https://news.solarbe.com/202605/001.html"><b>索比新闻一</b><span>2026-05-11</span></a>
      <a href="https://news.solarbe.com/202605/002.html"><b>索比新闻二</b><span>2026-05-10</span></a>
      <a href="https://news.solarbe.com/202605/003.html"><b>索比新闻三</b><span>2026-05-09</span></a>
    </div>`;
    const fetchImpl = async (url: string) =>
      url.endsWith("/robots.txt") ? new Response("") : new Response(html);
    const items = await fetchHtml(
      {
        type: "html",
        listUrl: "https://www.solarbe.com/news/",
        selectors: {
          item: '.xNews_left a[href*="news.solarbe.com/20"]',
          title: "b",
          link: "a",
          date: "span"
        }
      },
      { sourceName: "solarbe-anchor", useRealUa: true },
      fetchImpl as typeof fetch
    );

    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items[0]?.title).toBe("索比新闻一");
    expect(items[0]?.url).toBe("https://news.solarbe.com/202605/001.html");
  });
});

describe("parsePublishedAt", () => {
  it("treats YYYY年M月D日 as Asia/Shanghai and preserves time when present", () => {
    const parsed = parsePublishedAt("2026年5月11日 09:30");
    expect(parsed).not.toBeNull();
    expect(parsed?.toISOString()).toBe("2026-05-11T01:30:00.000Z");
  });

  it("treats YYYY.M.D as Asia/Shanghai", () => {
    const parsed = parsePublishedAt("2026.5.11");
    expect(parsed).not.toBeNull();
    expect(parsed?.toISOString()).toBe("2026-05-10T16:00:00.000Z");
  });

  it("treats YYYY/M/D and YYYY-M-D as Asia/Shanghai", () => {
    const slash = parsePublishedAt("2026/05/11");
    const hy = parsePublishedAt("2026-05-11 12:00:00");
    expect(slash?.toISOString()).toBe("2026-05-10T16:00:00.000Z");
    expect(hy?.toISOString()).toBe("2026-05-11T04:00:00.000Z");
  });

  it("preserves an explicit timezone", () => {
    const parsed = parsePublishedAt("2026-05-11T09:30:00Z");
    expect(parsed?.toISOString()).toBe("2026-05-11T09:30:00.000Z");
  });

  it("returns null for missing or invalid dates", () => {
    expect(parsePublishedAt(null)).toBeNull();
    expect(parsePublishedAt("")).toBeNull();
    expect(parsePublishedAt("not a date")).toBeNull();
    expect(parsePublishedAt("2026-13-40")).toBeNull();
  });
});

describe("fetchHtml date validation", () => {
  it("drops rows with missing dates and throws when none remain", async () => {
    const html = `<ul>
      <li class="item"><a class="title" href="/a">新闻 A</a><span class="date"></span></li>
      <li class="item"><a class="title" href="/b">新闻 B</a><span class="date">not-a-date</span></li>
    </ul>`;
    const fetchImpl = async (url: string) =>
      url.endsWith("/robots.txt") ? new Response("") : new Response(html);

    await expect(
      fetchHtml(
        {
          type: "html",
          listUrl: "https://example.com/news/",
          selectors: {
            item: ".item",
            title: ".title",
            link: ".title",
            date: ".date"
          }
        },
        { sourceName: "test-no-dates" },
        fetchImpl as typeof fetch
      )
    ).rejects.toMatchObject({ code: "FETCH_HTML_EMPTY" });
  });

  it("keeps rows with valid Chinese dates and discards siblings without dates", async () => {
    const html = `<ul>
      <li class="item"><a class="title" href="/a">新闻 A</a><span class="date">2026年5月11日</span></li>
      <li class="item"><a class="title" href="/b">新闻 B</a><span class="date"></span></li>
    </ul>`;
    const fetchImpl = async (url: string) =>
      url.endsWith("/robots.txt") ? new Response("") : new Response(html);

    const items = await fetchHtml(
      {
        type: "html",
        listUrl: "https://example.com/news/",
        selectors: {
          item: ".item",
          title: ".title",
          link: ".title",
          date: ".date"
        }
      },
      { sourceName: "test-mixed-dates" },
      fetchImpl as typeof fetch
    );

    expect(items.length).toBe(1);
    expect(items[0]?.title).toBe("新闻 A");
    expect(items[0]?.publishedAt.toISOString()).toBe(
      "2026-05-10T16:00:00.000Z"
    );
  });
});
