import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared validation helpers
// ---------------------------------------------------------------------------

export function validationError(details: unknown): Response {
  return Response.json({ error: { code: "VALIDATION", message: "参数校验失败", details } }, { status: 400 });
}

// ---------------------------------------------------------------------------
// Briefing list query
// ---------------------------------------------------------------------------

export const briefingListQuerySchema = z.object({
  cursor: z.string().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

// ---------------------------------------------------------------------------
// Briefing detail cursor encoding
// ---------------------------------------------------------------------------

export interface BriefingCursorPayload {
  briefingDate: string;
  id: number;
}

export function encodeBriefingCursor(payload: BriefingCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeBriefingCursor(cursor: string | undefined): BriefingCursorPayload | null {
  if (!cursor) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<BriefingCursorPayload>;
    if (!parsed.briefingDate || typeof parsed.id !== "number") {
      return null;
    }
    return { briefingDate: parsed.briefingDate, id: parsed.id };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Briefing targets CRUD
// ---------------------------------------------------------------------------

export const createTargetSchema = z.object({
  name: z.string().min(1).max(100),
  channel: z.enum(["dingtalk_bot"]),
  webhookUrl: z.string().url(),
  signSecret: z.string().min(1).nullable().optional(),
  enabled: z.boolean().optional().default(true)
});

export const updateTargetSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  channel: z.enum(["dingtalk_bot"]).optional(),
  // Only apply when caller sends a non-empty valid URL; omit / empty = keep existing.
  webhookUrl: z.string().url().optional(),
  signSecret: z.string().min(1).nullable().optional(),
  enabled: z.boolean().optional()
});

// ---------------------------------------------------------------------------
// Target credential redaction (NFR-02 / T-DUP Round 2)
// Never return raw webhook_url or sign_secret in API responses.
// ---------------------------------------------------------------------------

export interface PublicBriefingTarget {
  id: number;
  name: string;
  channel: string;
  enabled: boolean;
  createdAt: Date | string | null;
  webhookUrlMasked: string;
  webhookConfigured: boolean;
  signSecretConfigured: boolean;
}

/**
 * Mask a DingTalk webhook URL for API/UI display.
 * Strips query string so access_token never appears in responses.
 */
export function maskWebhookUrl(webhookUrl: string): string {
  const raw = webhookUrl.trim();
  if (!raw) return "—";
  try {
    const parsed = new URL(raw);
    // origin + pathname only — no search/hash (access_token lives in query)
    return `${parsed.origin}${parsed.pathname}?***(masked)`;
  } catch {
    // Never echo raw input that may contain tokens
    return "**(invalid-url)**";
  }
}

/** Map a DB target row to a credential-safe public DTO. */
export function toPublicTarget(target: {
  id: number;
  name: string;
  channel: string;
  webhookUrl: string;
  signSecret: string | null;
  enabled: boolean;
  createdAt?: Date | string | null;
}): PublicBriefingTarget {
  const webhookConfigured = target.webhookUrl.trim().length > 0;
  const signSecretConfigured = Boolean(
    target.signSecret != null && target.signSecret.trim().length > 0
  );
  return {
    id: target.id,
    name: target.name,
    channel: target.channel,
    enabled: target.enabled,
    createdAt: target.createdAt ?? null,
    webhookUrlMasked: webhookConfigured ? maskWebhookUrl(target.webhookUrl) : "—",
    webhookConfigured,
    signSecretConfigured,
  };
}

// ---------------------------------------------------------------------------
// Regenerate / repush payload
// ---------------------------------------------------------------------------

export const regenerateSchema = z.object({
  force: z.boolean().optional().default(false)
});

// ---------------------------------------------------------------------------
// Daily push schedule (T-DUP-03)
// ---------------------------------------------------------------------------

const HH_MM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/** baseUrl: absolute http(s) only; trailing slashes stripped on parse. */
export const scheduleConfigSchema = z.object({
  enabled: z.boolean(),
  /** 产业日报推送时间 */
  sendTime: z.string().regex(HH_MM, "sendTime 必须为 HH:mm"),
  /** 铜锂日报推送时间（0060 拆分）。optional 让未升级的旧前端 PUT 仍能通过。 */
  briefingSendTime: z.string().regex(HH_MM, "briefingSendTime 必须为 HH:mm").optional(),
  scheduleMode: z.enum(["daily", "business_days"]),
  baseUrl: z
    .string()
    .min(1)
    .superRefine((value, ctx) => {
      let parsed: URL;
      try {
        parsed = new URL(value.trim());
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "baseUrl 必须是合法绝对 URL" });
        return;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "baseUrl 仅允许 http/https" });
      }
    })
    .transform((value) => stripTrailingSlashes(value.trim()))
});

// ---------------------------------------------------------------------------
// Quotes query
// ---------------------------------------------------------------------------

export const quotesLatestQuerySchema = z.object({
  metricKeys: z.string().min(1).optional()
});
