import { eq } from "drizzle-orm";
import { dailyReports, getDb } from "@fe-radar/db";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";
import { authenticateDongdongRequest } from "@/lib/auth/dongdong-service";
import { isMockMode } from "@/lib/mock-mode";
import { mockDailyReport } from "@/lib/mock-data";

import type { NextRequest } from "next/server";

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await authenticateDongdongRequest(request);
  if (auth.error) return auth.error;

  const date =
    request.nextUrl.searchParams.get("date") ??
    dayjs().tz(APP_TIMEZONE).format("YYYY-MM-DD");
  if (isMockMode()) return Response.json({ report: mockDailyReport(date) });
  const [report] = await getDb()
    .select()
    .from(dailyReports)
    .where(eq(dailyReports.date, date))
    .limit(1);
  return report
    ? Response.json({ report })
    : Response.json(
        { error: { code: "NOT_FOUND", message: "日报不存在" } },
        { status: 404 }
      );
}
