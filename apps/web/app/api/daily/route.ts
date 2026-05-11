import { eq } from "drizzle-orm";
import { dailyReports, getDb } from "@fe-radar/db";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? dayjs().tz(APP_TIMEZONE).format("YYYY-MM-DD");
  const [report] = await getDb().select().from(dailyReports).where(eq(dailyReports.date, date)).limit(1);
  if (!report) {
    return Response.json({ error: { code: "NOT_FOUND", message: "日报不存在" } }, { status: 404 });
  }
  return Response.json({ report });
}
