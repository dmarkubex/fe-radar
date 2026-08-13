import { and, desc, eq, inArray } from "drizzle-orm";
import { commodityBriefings, getDb } from "@fe-radar/db";
import { authenticateDongdongRequest } from "@/lib/auth/dongdong-service";

import type { NextRequest } from "next/server";

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await authenticateDongdongRequest(request);
  if (auth.error) return auth.error;

  const date = request.nextUrl.searchParams.get("date")?.trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "参数错误" } },
      { status: 400 }
    );
  }
  const [briefing] = await getDb()
    .select({
      id: commodityBriefings.id,
      date: commodityBriefings.briefingDate,
      payload: commodityBriefings.payloadJson
    })
    .from(commodityBriefings)
    .where(
      and(
        inArray(commodityBriefings.genStatus, ["succeeded", "degraded"]),
        date ? eq(commodityBriefings.briefingDate, date) : undefined
      )
    )
    .orderBy(desc(commodityBriefings.briefingDate), desc(commodityBriefings.id))
    .limit(1);
  return briefing
    ? Response.json({
        briefing: { ...briefing, path: `/briefing/${briefing.id}` }
      })
    : Response.json(
        { error: { code: "NOT_FOUND", message: "铜锂日报不存在" } },
        { status: 404 }
      );
}
