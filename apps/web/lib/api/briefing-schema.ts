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
  webhookUrl: z.string().url().optional(),
  signSecret: z.string().min(1).nullable().optional(),
  enabled: z.boolean().optional()
});

// ---------------------------------------------------------------------------
// Regenerate / repush payload
// ---------------------------------------------------------------------------

export const regenerateSchema = z.object({
  force: z.boolean().optional().default(false)
});

// ---------------------------------------------------------------------------
// Quotes query
// ---------------------------------------------------------------------------

export const quotesLatestQuerySchema = z.object({
  metricKeys: z.string().min(1).optional()
});
