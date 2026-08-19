import { describe, expect, it } from "vitest";

import {
  DETAIL_READY_SELECTOR,
  EXTRACT_MAX_LENGTH,
  EXTRACT_MIN_LENGTH,
  ExtractTooShortError,
  extractDetailPlainText
} from "../article-text";

/** 重复字符快速构造 ≥ N 字文本。 */
function lorem(length: number, seed = "x"): string {
  let s = "";
  while (s.length < length) s += seed;
  return s.slice(0, length);
}

describe("extractDetailPlainText", () => {
  it("extracts text from <article> when ≥ 80 chars", () => {
    const body = lorem(EXTRACT_MIN_LENGTH + 20);
    const html = `<html><body><nav>ignored nav</nav><article>${body}</article><script>noise()</script></body></html>`;
    const out = extractDetailPlainText(html);
    expect(out.content).toBe(body);
    expect(out.truncated).toBe(false);
  });

  it("returns TOO_SHORT when only nav exists (no candidate reaches 80 chars)", () => {
    const html = "<html><body><nav>tiny</nav><footer>tiny too</footer></body></html>";
    expect(() => extractDetailPlainText(html)).toThrow(ExtractTooShortError);
  });

  it("removes script/style/noscript/iframe content from the candidate", () => {
    const body = lorem(100, "y");
    const html = `<html><body>
      <article>
        <script>var ignore=1;</script>
        <style>body { color: red; }</style>
        <noscript>nope</noscript>
        <iframe src="x">x</iframe>
        ${body}
      </article>
    </body></html>`;
    const out = extractDetailPlainText(html);
    expect(out.content).toBe(body);
    expect(out.truncated).toBe(false);
  });

  it("marks truncated=true and slices to 20000 when input exceeds 20001 chars", () => {
    const long = lorem(EXTRACT_MAX_LENGTH + 1, "z");
    const html = `<article>${long}</article>`;
    const out = extractDetailPlainText(html);
    expect(out.content.length).toBe(EXTRACT_MAX_LENGTH);
    expect(out.truncated).toBe(true);
  });

  it("marks truncated=false at exactly 20000 chars", () => {
    const exact = lorem(EXTRACT_MAX_LENGTH, "q");
    const html = `<article>${exact}</article>`;
    const out = extractDetailPlainText(html);
    expect(out.content.length).toBe(EXTRACT_MAX_LENGTH);
    expect(out.truncated).toBe(false);
  });

  it("DETAIL_READY_SELECTOR does not contain body (Playwright wait guard invariant)", () => {
    expect(DETAIL_READY_SELECTOR).not.toMatch(/\bbody\b/);
  });

  it("falls back to body when no earlier candidate qualifies", () => {
    // 候选顺序：`article` (空) → `[role=main]` (空) → `main` (空) →
    //   `.article-content` / `.article` / `#content` / `.content` (都空) → `body`。
    // body 是唯一含 ≥ 80 字文本的容器；提取时噪音元素 (nav/footer) 已被剥掉。
    const body = lorem(150, "w");
    const html = `<html><body><nav>ignored</nav><footer>ignored</footer>${body}</body></html>`;
    const out = extractDetailPlainText(html);
    expect(out.content).toBe(body);
    expect(out.truncated).toBe(false);
  });
});