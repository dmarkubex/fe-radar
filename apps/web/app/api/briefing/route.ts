import { and, desc, eq, lt, or } from "drizzle-orm";
import { getDb, commodityBriefings } from "@fe-radar/db";
import { getRequestUser } from "@/lib/api/authz";
import {
  briefingListQuerySchema,
  decodeBriefingCursor,
  encodeBriefingCursor,
  validationError
} from "@/lib/api/briefing-schema";

import type { NextRequest } from "next/server";

export async function GET(request: NextRequest): Promise<Response> {
  const user = await getRequestUser(request);
  if (!user.role) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = briefingListQuerySchema.safeParse({
    cursor: searchParams.get("cursor") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined
  });
  if (!parsed.success) {
    return validationError(parsed.error.flatten());
  }

  const { cursor, pageSize } = parsed.data;
  const db = getDb();

  let query = db
    .select()
    .from(commodityBriefings)
    .orderBy(desc(commodityBriefings.briefingDate), desc(commodityBriefings.id))
    .limit(pageSize + 1);

  const cursorPayload = decodeBriefingCursor(cursor);
  if (cursorPayload) {
    query = query.where(
      or(
        lt(commodityBriefings.briefingDate, cursorPayload.briefingDate),
        and(
          eq(commodityBriefings.briefingDate, cursorPayload.briefingDate),
          lt(commodityBriefings.id, cursorPayload.id)
        )
      )
    ) as typeof query;
  }

  const rows = await query;
  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1]!;
    nextCursor = encodeBriefingCursor({ briefingDate: last.briefingDate, id: last.id });
  }

  return Response.json({ items, nextCursor });
}
