import { eq } from "drizzle-orm";
import { dailyReports, getDb } from "@fe-radar/db";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";
import { isMockMode } from "@/lib/mock-mode";
import { mockDailyReport } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

type DailySections = Record<string, unknown>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// key 必须与 DAILY_REPORT_SCHEMA.sections 的 5 个字段一致（policy/market/tech/project/company）
const DIMENSIONS = [
  { key: "policy", no: "01", title: "政策", sub: "POLICY" },
  { key: "market", no: "02", title: "市场", sub: "MARKET" },
  { key: "tech", no: "03", title: "技术", sub: "TECHNOLOGY" },
  { key: "project", no: "04", title: "项目", sub: "PROJECTS" },
  { key: "company", no: "05", title: "公司", sub: "COMPANY" }
] as const;

export default async function DailyPage({ searchParams }: { searchParams: PageSearchParams }): Promise<React.JSX.Element> {
  const params = await searchParams;
  const selectedDate = first(params.date) ?? dayjs().tz(APP_TIMEZONE).format("YYYY-MM-DD");
  const [report] = isMockMode()
    ? [mockDailyReport(selectedDate)]
    : await getDb().select().from(dailyReports).where(eq(dailyReports.date, selectedDate)).limit(1);

  const dates = Array.from({ length: 7 }, (_, i) => dayjs().tz(APP_TIMEZONE).subtract(i, "day").format("YYYY-MM-DD"));
  const sections = report?.sections as DailySections | undefined;
  const dateDisplay = dayjs(selectedDate).tz(APP_TIMEZONE).format("YYYY 年 M 月 D 日 dddd");
  const issueNo = dayjs(selectedDate).tz(APP_TIMEZONE).format("YYYYMMDD");

  return (
    <main className="bg-bg">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-bg pad-fluid-x py-3.5">
        <div className="font-mono text-[11px] uppercase tracking-[1px] text-fg-muted">监测 / 日报</div>
        <div className="flex flex-wrap gap-1.5">
          {dates.map((date) => (
            <a key={date} href={`/daily?date=${date}`} className={`border px-3 py-1.5 font-mono text-[11px] ${date === selectedDate ? "border-fg bg-fg text-white" : "border-border bg-surface text-fg-muted hover:bg-bg-deep"}`}>
              {dayjs(date).tz(APP_TIMEZONE).format("M/D")}
            </a>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-[1120px] pad-fluid-x">
        <header className="flex items-end justify-between gap-8 border-b-4 border-double border-fg py-5">
          <div className="flex items-center gap-4">
            <img src="/fareast-logo.png" alt="远东控股集团" className="h-auto w-[142px] border border-border bg-white px-2 py-1" />
            <div className="font-display text-[28px] font-normal tracking-[-0.6px] text-fg">
              产业日报
              <small className="block font-mono text-[10px] uppercase tracking-[1.6px] text-fg-soft">FE-Radar / Daily Intelligence Brief</small>
            </div>
          </div>
          <div className="text-right font-mono text-[11px] uppercase tracking-[1.4px] text-fg-soft">
            <b className="mb-1 block text-sm font-normal tracking-[0.6px] text-fg">No. {issueNo}</b>
            {dateDisplay}
          </div>
        </header>

        {sections ? (
          <>
            {DIMENSIONS.map((dim) => {
              const content = text(sections[dim.key], "");
              if (!content) return null;
              return (
                <section key={dim.key} className="border-b border-border py-8">
                  <div className="mb-3.5 flex items-center gap-2.5">
                    <span className="grid h-[30px] w-[30px] place-items-center bg-fg font-mono text-[11px] text-white">{dim.no}</span>
                    <h2 className="m-0 font-display text-[28px] font-normal leading-none tracking-[-0.8px] text-fg">
                      {dim.title}
                      <small className="mt-1.5 block font-mono text-[11px] uppercase tracking-[1.4px] text-fg-soft">{dim.sub}</small>
                    </h2>
                  </div>
                  <p className="m-0 max-w-[76ch] whitespace-pre-line text-base leading-[1.7] text-fg-muted">{content}</p>
                </section>
              );
            })}

            <blockquote className="my-6 max-w-[72ch] border-y border-border py-10">
              <span className="mb-3 block font-display text-[100px] leading-[0.6] text-accent">“</span>
              <q className="font-display text-[28px] leading-[1.3] tracking-[-0.6px] text-fg">信源比信息重要，先精选信源，再处理信息。</q>
              <cite className="mt-4 block font-mono text-[11px] not-italic uppercase tracking-[1.4px] text-fg-soft">FE-Radar operating principle</cite>
            </blockquote>

            <footer className="mt-6 flex flex-wrap justify-between gap-8 border-t-4 border-double border-fg py-12">
              <Col title="分发" body="钉钉群推送、邮件订阅、内部门户。每日 08:00 自动生成。" />
              <Col title="反馈" body="条目反馈按钮、日报评分。管理员调整信源与评分权重。" />
              <Col title="导出" body="PDF 日报、Excel 数据表。数据保留 90 天。" />
            </footer>
          </>
        ) : (
          <div className="py-20 text-center text-sm text-fg-soft">该日期暂无日报</div>
        )}
      </div>
    </main>
  );
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function Col({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <div>
      <h4 className="mb-2.5 font-mono text-[11px] font-normal uppercase tracking-[1.6px] text-fg-soft">{title}</h4>
      <p className="m-0 max-w-[36ch] text-[13px] leading-[1.55] text-fg-muted">{body}</p>
    </div>
  );
}
