/**
 * T-CA-05 / design §3.4.1：详情正文抽取（与 Playwright DETAIL_READY_SELECTOR 共用）。
 *
 * - 选择器清单按 `article` → `[role=main]` → `main` → `.article-content, .article,
 *   #content, .content` → `body` 顺序尝试；**不含** `body` 在选择器串里（`body`
 *   总会命中，会绕开候选顺序）—— selector 仅给 Playwright `waitForSelector` 用，
 *   抽取函数本身仍允许 body 兜底（设计第 2 步明确写了）。
 * - 先移除噪音（script / style / noscript / nav / footer / iframe）再按序选首个。
 * - 空白折叠 `/\s+/` → 单空格 → trim。
 * - 落库 / 响应截断 20000；`truncated` 必须在 slice 之前算 `截断前 length > 20000`。
 *
 * 抽出 `EXTRACT_TOO_SHORT` 让调用方把 `extractDetailPlainText` 抛错统一映射为
 * `EXTRACT_TOO_SHORT` reason（HTTP handler 与 detail-fetch job 都用）。
 */
import * as cheerio from "cheerio";

/** Playwright `waitForSelector` 与抽取候选共用的选择器串（**不含** body）。 */
export const DETAIL_READY_SELECTOR =
  "article, [role=main], main, .article-content, .article, #content, .content";

/** 抽取成功后的最小文本长度（设计第 4 步）。 */
export const EXTRACT_MIN_LENGTH = 80;

/** 落库 / 响应截断上限（设计第 5 步 + §3.4.1 step 6 抽前算 truncated）。 */
export const EXTRACT_MAX_LENGTH = 20000;

/** 调用方据此 reason 映射 `EXTRACT_TOO_SHORT`。 */
export class ExtractTooShortError extends Error {
  public readonly code = "EXTRACT_TOO_SHORT";
  public constructor(message = "article text below minimum length") {
    super(message);
    this.name = "ExtractTooShortError";
  }
}

/** 抽取顺序（body 在最后兜底，**不**进入选择器串）。 */
const CANDIDATE_SELECTORS = [
  "article",
  "[role=main]",
  "main",
  ".article-content",
  ".article",
  "#content",
  ".content",
  "body"
] as const;

const NOISE_SELECTORS = ["script", "style", "noscript", "nav", "footer", "iframe"];

export interface ExtractedArticle {
  /** 已空白折叠 + trim，仍可能 ≥ EXTRACT_MAX_LENGTH（截断前）。 */
  content: string;
  /** `截断前 length > EXTRACT_MAX_LENGTH`，在 slice 之前算。 */
  truncated: boolean;
}

export function extractDetailPlainText(html: string): ExtractedArticle {
  const $ = cheerio.load(html);
  for (const sel of NOISE_SELECTORS) {
    $(sel).remove();
  }

  let raw = "";
  for (const selector of CANDIDATE_SELECTORS) {
    const node = $(selector).first();
    if (node.length === 0) {
      continue;
    }
    const text = node.text().replace(/\s+/g, " ").trim();
    if (text.length >= EXTRACT_MIN_LENGTH) {
      raw = text;
      break;
    }
  }

  if (raw.length < EXTRACT_MIN_LENGTH) {
    throw new ExtractTooShortError(
      `no candidate node produced text ≥ ${EXTRACT_MIN_LENGTH} chars`
    );
  }

  // §3.4.1 step 5：truncated 必须在 slice 之前算（落库列）。
  const truncated = raw.length > EXTRACT_MAX_LENGTH;
  const content = truncated ? raw.slice(0, EXTRACT_MAX_LENGTH) : raw;
  return { content, truncated };
}