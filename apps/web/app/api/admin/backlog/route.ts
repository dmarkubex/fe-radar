import { and, desc, eq, lt } from "drizzle-orm";
import { getDb, itemAnalysis, items, sources } from "@fe-radar/db";
import { backlogQuerySchema } from "@/lib/api/backlog-schema";
import { requireFreshRole } from "@/lib/api/authz";

import type { NextRequest } from "next/server";

function encodeCursor(fetchedAt: Date, id: number): string {
  return Buffer.from(JSON.stringify({ fetchedAt: fetchedAt.toISOString(), id }), "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): { fetchedAt: Date; id: number } | null {
  if (!cursor) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { fetchedAt?: string; id?: number };
    return parsed.fetchedAt && typeof parsed.id === "number" ? { fetchedAt: new Date(parsed.fetchedAt), id: parsed.id } : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest): Promise<Response> {
  const authError = await requireFreshRole(request, "admin");
  if (authError) return authError;

  const { searchParams } = request.nextUrl;
  const parsed = backlogQuerySchema.safeParse({
    state: searchParams.get("state") ?? undefined,
    cursor: searchParams.get("cursor") ?? undefined,
    limit: searchParams.get("limit") ?? undefined
  });
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION", message: "参数校验失败", details: parsed.error.flatten() } }, { status: 400 });
  }

  const cursor = decodeCursor(parsed.data.cursor);
  const rows = await getDb()
    .select({
      id: items.id,
      title: items.title,
      sourceName: sources.name,
      fetchedAt: items.fetchedAt,
      quotaState: itemAnalysis.quotaState,
      summaryZh: itemAnalysis.summaryZh
    })
    .from(items)
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .innerJoin(itemAnalysis, eq(itemAnalysis.itemId, items.id))
    .where(and(
      parsed.data.state ? eq(itemAnalysis.quotaState, parsed.data.state) : undefined,
      cursor ? lt(items.fetchedAt, cursor.fetchedAt) : undefined
    ))
    .orderBy(desc(items.fetchedAt), desc(items.id))
    .limit(parsed.data.limit + 1);

  const page = rows.slice(0, parsed.data.limit);
  const last = page.at(-1);
  return Response.json({
    items: page.map((row) => ({ ...row, fetchedAt: row.fetchedAt.toISOString() })),
    nextCursor: rows.length > parsed.data.limit && last ? encodeCursor(last.fetchedAt, last.id) : null
  });
}
