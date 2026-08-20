import { sql } from "drizzle-orm";
import { getDb } from "@fe-radar/db";
import { requireFreshRole } from "@/lib/api/authz";

import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function parseLimit(raw: string | null): number {
  const n = raw === null ? 50 : Number(raw);
  if (!Number.isInteger(n) || n <= 0) return 50;
  return Math.min(n, 200);
}

function parseOffset(raw: string | null): number {
  const n = raw === null ? 0 : Number(raw);
  if (!Number.isInteger(n) || n < 0) return 0;
  return n;
}

function parseRating(raw: string | null): 1 | -1 | null {
  if (raw === null || raw === "") return null;
  if (raw === "1") return 1;
  if (raw === "-1") return -1;
  return null;
}

export async function GET(request: NextRequest): Promise<Response> {
  const authError = await requireFreshRole(request, "admin");
  if (authError) return authError;

  const { searchParams } = request.nextUrl;
  const ratingRaw = searchParams.get("rating");
  if (ratingRaw !== null && ratingRaw !== "" && ratingRaw !== "1" && ratingRaw !== "-1") {
    return Response.json(
      { error: { code: "VALIDATION", message: "rating 只能是 -1 或 1" } },
      { status: 400 }
    );
  }

  const limit = parseLimit(searchParams.get("limit"));
  const offset = parseOffset(searchParams.get("offset"));
  const rating = parseRating(ratingRaw);

  const db = getDb();
  const countResult = await db.execute<{ total: number }>(sql`
    SELECT count(*)::int AS total
    FROM copilot.audit_log a
    WHERE (${rating}::smallint IS NULL OR a.message_id IN (
      SELECT message_id FROM copilot.feedbacks WHERE rating = ${rating}
    ))
  `);

  const rows = await db.execute<{
    id: number;
    user_id: number;
    session_id: number | null;
    message_id: number | null;
    tool_name: string | null;
    args_preview: string | null;
    result_preview: string | null;
    token_usage: unknown;
    coverage: string;
    aborted: boolean;
    numbers_ungrounded: number;
    created_at: Date;
    rating: number | null;
  }>(sql`
    SELECT
      a.id,
      a.user_id,
      a.session_id,
      a.message_id,
      a.tool_name,
      a.args_preview,
      a.result_preview,
      a.token_usage,
      a.coverage,
      a.aborted,
      a.numbers_ungrounded,
      a.created_at,
      CASE
        WHEN ${rating}::smallint IS NOT NULL THEN ${rating}::smallint
        ELSE (
          SELECT f.rating
          FROM copilot.feedbacks f
          WHERE f.message_id = a.message_id
          ORDER BY f.created_at DESC
          LIMIT 1
        )
      END AS rating
    FROM copilot.audit_log a
    WHERE (${rating}::smallint IS NULL OR a.message_id IN (
      SELECT message_id FROM copilot.feedbacks WHERE rating = ${rating}
    ))
    ORDER BY a.id DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const countRow = firstExecuteRow<{ total: number }>(countResult);
  const items = executeRows(rows).map((row) => ({
    id: Number(row.id),
    userId: Number(row.user_id),
    sessionId: row.session_id === null ? null : Number(row.session_id),
    messageId: row.message_id === null ? null : Number(row.message_id),
    toolName: row.tool_name,
    argsPreview: row.args_preview,
    resultPreview: row.result_preview,
    tokenUsage: row.token_usage,
    coverage: row.coverage,
    aborted: row.aborted,
    numbersUngrounded: row.numbers_ungrounded,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    rating: row.rating === null ? null : Number(row.rating)
  }));

  const total = Number(countRow?.total ?? 0);
  return Response.json({ items, total });
}

function firstExecuteRow<T>(result: unknown): T | undefined {
  return Array.isArray(result) ? (result[0] as T | undefined) : undefined;
}

function executeRows<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : [];
}
