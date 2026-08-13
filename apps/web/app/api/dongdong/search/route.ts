import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { commodityBriefings, dailyReports, getDb } from "@fe-radar/db";
import { z } from "zod";
import { authenticateDongdongRequest } from "@/lib/auth/dongdong-service";
import { fetchTimeline } from "@/lib/api/timeline-query";
import { searchQuerySchema } from "@/lib/api/timeline-schema";

import type { NextRequest } from "next/server";

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await authenticateDongdongRequest(request);
  if (auth.error) return auth.error;

  const { searchParams } = request.nextUrl;
  const requestQuery = z
    .object({
      scope: z.enum(["news", "daily", "briefing"]).default("news"),
      q: z.string().trim().max(200).optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20)
    })
    .safeParse({
      scope: searchParams.get("scope") ?? undefined,
      q: searchParams.get("q") ?? undefined,
      date: searchParams.get("date") ?? undefined,
      limit: searchParams.get("limit") ?? undefined
    });
  if (
    !requestQuery.success ||
    (requestQuery.data.scope === "news" && !requestQuery.data.q)
  ) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "参数错误" } },
      { status: 400 }
    );
  }

  const { scope, q, date, limit } = requestQuery.data;
  if (scope === "daily") {
    const rows = await getDb()
      .select({ date: dailyReports.date, sections: dailyReports.sections })
      .from(dailyReports)
      .where(
        and(
          date ? eq(dailyReports.date, date) : undefined,
          q
            ? sql<boolean>`${dailyReports.sections}::text ILIKE ${`%${q}%`}`
            : undefined
        )
      )
      .orderBy(desc(dailyReports.date))
      .limit(limit);
    return Response.json({
      items: rows.map((row) => ({
        type: "daily",
        id: row.date,
        title: `产业日报 · ${row.date}`,
        sections: row.sections,
        path: `/daily?date=${encodeURIComponent(row.date)}`
      }))
    });
  }

  if (scope === "briefing") {
    const rows = await getDb()
      .select({
        id: commodityBriefings.id,
        date: commodityBriefings.briefingDate,
        payload: commodityBriefings.payloadJson
      })
      .from(commodityBriefings)
      .where(
        and(
          inArray(commodityBriefings.genStatus, ["succeeded", "degraded"]),
          date ? eq(commodityBriefings.briefingDate, date) : undefined,
          q
            ? sql<boolean>`${commodityBriefings.payloadJson}::text ILIKE ${`%${q}%`}`
            : undefined
        )
      )
      .orderBy(
        desc(commodityBriefings.briefingDate),
        desc(commodityBriefings.id)
      )
      .limit(limit);
    return Response.json({
      items: rows.map((row) => ({
        type: "briefing",
        id: row.id,
        title: `铜锂日报 · ${row.date}`,
        date: row.date,
        payload: row.payload,
        path: `/briefing/${row.id}`
      }))
    });
  }

  const parsed = searchQuerySchema.safeParse({
    q,
    cursor: searchParams.get("cursor") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    circle: searchParams.get("circle") ?? undefined,
    tier: searchParams.get("tier") ?? undefined,
    eventType: searchParams.get("event_type") ?? undefined,
    alertType: searchParams.get("alert_type") ?? undefined
  });
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "参数错误",
          details: parsed.error.flatten()
        }
      },
      { status: 400 }
    );
  }
  return Response.json(
    await fetchTimeline({
      filters: parsed.data,
      includeBlocked: false,
      includeNonIndustry: false,
      cursor: parsed.data.cursor,
      limit,
      search: parsed.data.q
    })
  );
}
