/**
 * Pure constructor for the unified DingTalk ActionCard (daily report + commodity briefing).
 * No I/O. Price numbers must never be extracted/rewritten from free text — only language fields.
 */

/** Max Unicode code points kept per daily-report section body (deterministic truncation). */
export const DAILY_SECTION_MAX_CHARS = 160;

/** Max Unicode code points for briefing language snippets. */
export const BRIEFING_SNIPPET_MAX_CHARS = 120;

export const DAILY_SECTION_ORDER = [
  "policy",
  "market",
  "tech",
  "project",
  "company",
] as const;

export type DailySectionKey = (typeof DAILY_SECTION_ORDER)[number];

const DAILY_SECTION_LABELS: Record<DailySectionKey, string> = {
  policy: "政策",
  market: "市场",
  tech: "技术",
  project: "项目",
  company: "公司",
};

export interface DailyReportSections {
  policy?: string | null;
  market?: string | null;
  tech?: string | null;
  project?: string | null;
  company?: string | null;
  [key: string]: string | null | undefined;
}

export interface BriefingCardPayload {
  cu?: { logic_summary?: string | null; outlook?: { trend?: string | null } | null } | null;
  lc?: { logic_summary?: string | null; outlook?: { trend?: string | null } | null } | null;
  macro_summary?: string | null;
  procurement_advice?: string | null;
  [key: string]: unknown;
}

export interface BuildDailyPushCardInput {
  reportDate: string; // YYYY-MM-DD
  baseUrl: string;
  dailySections?: DailyReportSections | null;
  briefing?: {
    id: number;
    genStatus?: string | null;
    payload?: BriefingCardPayload | null;
  } | null;
}

export interface DailyPushCardBtn {
  title: string;
  actionURL: string;
}

export interface DailyPushCard {
  title: string;
  text: string;
  btns: DailyPushCardBtn[];
}

/**
 * Truncate by Unicode code points (not UTF-16 code units) and append ellipsis when clipped.
 */
export function truncateText(input: string, maxChars: number): string {
  const chars = Array.from(input.trim());
  if (chars.length <= maxChars) return chars.join("");
  if (maxChars <= 1) return "…";
  return `${chars.slice(0, maxChars - 1).join("")}…`;
}

/**
 * Validate and normalize baseUrl: only http(s), strip trailing slashes.
 * Throws TypeError / Error on illegal values.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`非法 baseUrl：${baseUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`baseUrl 仅允许 http/https：${baseUrl}`);
  }
  // Drop trailing slash(es) from pathname root form: origin only keeps no trailing /
  const normalized = parsed.href.replace(/\/+$/, "");
  return normalized;
}

/** Join a fixed relative path onto a validated base URL. */
export function joinBaseUrl(baseUrl: string, relativePath: string): string {
  const base = normalizeBaseUrl(baseUrl);
  const path = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  return new URL(path, `${base}/`).toString();
}

/** True only when at least one of the five fixed sections has non-empty text (empty `{}` is false). */
export function hasDailyContent(sections: DailyReportSections | null | undefined): boolean {
  if (!sections) return false;
  return DAILY_SECTION_ORDER.some((key) => {
    const value = sections[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function buildDailyLines(sections: DailyReportSections): string[] {
  const lines: string[] = ["### 产业日报", ""];
  for (const key of DAILY_SECTION_ORDER) {
    const raw = sections[key];
    if (typeof raw !== "string" || raw.trim().length === 0) continue;
    const label = DAILY_SECTION_LABELS[key];
    lines.push(`**${label}**：${truncateText(raw, DAILY_SECTION_MAX_CHARS)}`);
  }
  return lines;
}

function buildBriefingLines(
  briefing: NonNullable<BuildDailyPushCardInput["briefing"]>
): string[] {
  const lines: string[] = ["### 铜锂行情简报", ""];
  const payload = briefing.payload ?? null;
  let wroteLanguage = false;

  if (payload) {
    const cuTrend = payload.cu?.outlook?.trend;
    const lcTrend = payload.lc?.outlook?.trend;
    const cuLogic = payload.cu?.logic_summary;
    const lcLogic = payload.lc?.logic_summary;
    const macro = payload.macro_summary;
    const advice = payload.procurement_advice;

    if (typeof cuTrend === "string" && cuTrend.trim()) {
      lines.push(`铜：${truncateText(cuTrend, BRIEFING_SNIPPET_MAX_CHARS)}`);
      wroteLanguage = true;
    } else if (typeof cuLogic === "string" && cuLogic.trim()) {
      lines.push(`铜：${truncateText(cuLogic, BRIEFING_SNIPPET_MAX_CHARS)}`);
      wroteLanguage = true;
    }

    if (typeof lcTrend === "string" && lcTrend.trim()) {
      lines.push(`锂：${truncateText(lcTrend, BRIEFING_SNIPPET_MAX_CHARS)}`);
      wroteLanguage = true;
    } else if (typeof lcLogic === "string" && lcLogic.trim()) {
      lines.push(`锂：${truncateText(lcLogic, BRIEFING_SNIPPET_MAX_CHARS)}`);
      wroteLanguage = true;
    }

    if (typeof macro === "string" && macro.trim()) {
      lines.push(`宏观：${truncateText(macro, BRIEFING_SNIPPET_MAX_CHARS)}`);
      wroteLanguage = true;
    }
    if (typeof advice === "string" && advice.trim()) {
      lines.push(`采购建议：${truncateText(advice, BRIEFING_SNIPPET_MAX_CHARS)}`);
      wroteLanguage = true;
    }
  }

  if (!wroteLanguage) {
    const status = briefing.genStatus?.trim() || "unknown";
    lines.push(`生成状态：${status}`);
  }

  return lines;
}

/**
 * Build the unified ActionCard payload.
 * Callers must ensure at least one of dailySections / briefing is present when sending.
 */
export function buildDailyPushCard(input: BuildDailyPushCardInput): DailyPushCard {
  const { reportDate, dailySections, briefing } = input;
  const baseUrl = normalizeBaseUrl(input.baseUrl);

  const hasDaily = hasDailyContent(dailySections);
  const hasBriefing = briefing != null && Number.isFinite(briefing.id) && briefing.id > 0;

  if (!hasDaily && !hasBriefing) {
    throw new Error("daily-push-card: 日报与简报均不存在，无法构造卡片");
  }

  const title = hasDaily && hasBriefing
    ? `远东产业情报 · 合并日报 · ${reportDate}`
    : hasDaily
      ? `远东产业情报 · 日报 · ${reportDate}`
      : `远东·铜锂行情简报 · ${reportDate}`;

  const bodyParts: string[] = [];
  if (hasDaily && dailySections) {
    bodyParts.push(buildDailyLines(dailySections).join("\n"));
  }
  if (hasBriefing && briefing) {
    bodyParts.push(buildBriefingLines(briefing).join("\n"));
  }
  bodyParts.push("详情见站内页面。");

  const btns: DailyPushCardBtn[] = [];
  if (hasDaily) {
    btns.push({
      title: "查看产业日报",
      actionURL: joinBaseUrl(baseUrl, `/daily?date=${encodeURIComponent(reportDate)}`),
    });
  }
  if (hasBriefing && briefing) {
    btns.push({
      title: "查看铜锂行情简报",
      actionURL: joinBaseUrl(baseUrl, `/briefing/${briefing.id}`),
    });
  }

  return {
    title,
    text: bodyParts.join("\n\n"),
    btns,
  };
}
