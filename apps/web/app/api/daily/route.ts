import { eq } from "drizzle-orm";
import { dailyReports, getDb } from "@fe-radar/db";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";
import { isMockMode } from "@/lib/mock-mode";
import { mockDailyReport } from "@/lib/mock-data";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? dayjs().tz(APP_TIMEZONE).format("YYYY-MM-DD");
  if (isMockMode()) {
    return Response.json({ report: mockDailyReport(date) });
  }
  const [report] = await getDb().select().from(dailyReports).where(eq(dailyReports.date, date)).limit(1);
  if (!report) {
    return Response.json({ error: { code: "NOT_FOUND", message: "日报不存在" } }, { status: 404 });
  }
  return Response.json({ report });
}
