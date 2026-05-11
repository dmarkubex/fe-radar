import { describe, expect, it } from "vitest";
import { fetchHtml } from "../html";

describe("html fetcher", () => {
  it("extracts configured selectors without storing raw html", async () => {
    const html = `<ul><li class="item"><a class="title" href="/a">新闻 A</a><span class="date">2026-05-11</span></li></ul>`;
    const fetchImpl = async (url: string) => url.endsWith("/robots.txt") ? new Response("") : new Response(html);
    const items = await fetchHtml({
      type: "html",
      listUrl: "https://example.com/news/",
      selectors: { item: ".item", title: ".title", link: ".title", date: ".date" }
    }, { sourceName: "test" }, fetchImpl as typeof fetch);
    expect(items[0]?.content).toBe("新闻 A");
    expect(items[0]?.url).toBe("https://example.com/a");
  });
});
