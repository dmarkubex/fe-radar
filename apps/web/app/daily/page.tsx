import { eq } from "drizzle-orm";
import { dailyReports, getDb } from "@fe-radar/db";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

const SECTION_LABELS: Record<string, string> = {
  policy: "政策",
  market: "市场",
  tech: "技术",
  project: "项目",
  company: "公司"
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DailyPage({ searchParams }: { searchParams: PageSearchParams }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const selectedDate = first(params.date) ?? dayjs().tz(APP_TIMEZONE).format("YYYY-MM-DD");
  const [report] = await getDb().select().from(dailyReports).where(eq(dailyReports.date, selectedDate)).limit(1);
  const dates = Array.from({ length: 7 }, (_, index) => dayjs().tz(APP_TIMEZONE).subtract(index, "day").format("YYYY-MM-DD"));
  const sections = report?.sections as Record<string, string> | undefined;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-medium text-zinc-500">产业日报</p>
        <h1 className="text-2xl font-semibold text-zinc-950">日报</h1>
      </header>
      <div className="flex flex-wrap gap-2 rounded-lg border border-zinc-200 bg-white p-3">
        {dates.map((date) => (
          <a className={`rounded-md px-3 py-1.5 text-sm font-medium ${date === selectedDate ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`} href={`/daily?date=${date}`} key={date}>
            {date}
          </a>
        ))}
      </div>
      {sections ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(SECTION_LABELS).map(([key, label]) => (
            <section className="rounded-lg border border-zinc-200 bg-white p-5" key={key}>
              <h2 className="text-base font-semibold text-zinc-950">{label}</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-700">{sections[key] || "暂无内容"}</p>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">该日期暂无日报</div>
      )}
    </main>
  );
}
