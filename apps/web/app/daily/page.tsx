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

const DIMENSIONS = [
  { key: "policy", no: "01", title: "政策", sub: "POLICY" },
  { key: "market", no: "02", title: "产业链", sub: "SUPPLY CHAIN" },
  { key: "tech", no: "03", title: "市场", sub: "MARKET" },
  { key: "project", no: "04", title: "技术", sub: "TECHNOLOGY" },
  { key: "company", no: "05", title: "商业", sub: "BUSINESS" }
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
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-bg px-8 py-3.5">
        <div className="font-mono text-[11px] uppercase tracking-[1px] text-fg-muted">监测 / 日报</div>
        <div className="flex flex-wrap gap-1.5">
          {dates.map((date) => (
            <a key={date} href={`/daily?date=${date}`} className={`border px-3 py-1.5 font-mono text-[11px] ${date === selectedDate ? "border-fg bg-fg text-white" : "border-border bg-surface text-fg-muted hover:bg-bg-deep"}`}>
              {dayjs(date).tz(APP_TIMEZONE).format("M/D")}
            </a>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-[1120px] px-6">
        <header className="flex items-end justify-between gap-8 border-b-4 border-double border-fg py-5">
          <div className="flex items-center gap-4">
            <img src="/fareast-logo.png" alt="远东控股集团" className="h-auto w-[142px] border border-border bg-white px-2 py-1" />
            <div className="font-display text-[28px] font-normal tracking-[-0.6px] text-fg">
              产业日报
              <small className="block font-mono text-[10px] uppercase tracking-[1.6px] text-fg-soft">FE-Radar · Daily Intelligence Brief</small>
            </div>
          </div>
          <div className="text-right font-mono text-[11px] uppercase tracking-[1.4px] text-fg-soft">
            <b className="mb-1 block text-sm font-normal tracking-[0.6px] text-fg">No. {issueNo}</b>
            {dateDisplay}
          </div>
        </header>

        {sections ? (
          <>
            <section className="grid grid-cols-[minmax(0,1.15fr)_360px] items-start gap-6 border-b border-border py-[18px] max-[900px]:grid-cols-1">
              <div>
                <div className="mb-2 font-mono text-[11px] uppercase tracking-[2px] text-accent">今日判断</div>
                <h1 className="m-0 font-display text-[31px] font-normal leading-[1.08] tracking-[-0.7px] text-fg">{text(sections.hero_title, "今日产业情报总览")}</h1>
                <p className="mt-2.5 text-[13px] leading-[1.5] text-fg-muted">{text(sections.hero_summary, "暂无今日判断摘要。")}</p>
              </div>
              <aside className="border border-border bg-surface p-4">
                <div className="mb-3 font-mono text-[10px] uppercase tracking-[1.4px] text-fg-soft">精选速览</div>
                <div className="space-y-2">
                  {briefs(sections.briefs).map((brief, index) => (
                    <div key={brief} className="grid grid-cols-[24px_1fr] gap-2 border-b border-hairline pb-2 last:border-b-0 last:pb-0">
                      <span className="font-mono text-[11px] text-accent">{String(index + 1).padStart(2, "0")}</span>
                      <span className="text-xs leading-5 text-fg">{brief}</span>
                    </div>
                  ))}
                </div>
              </aside>
            </section>

            <section className="grid grid-cols-5 border-b border-border py-3 max-[760px]:grid-cols-2">
              {[
                ["抓取", sections.stat_fetched],
                ["精选", sections.stat_curated],
                ["自家", sections.stat_own],
                ["事故", sections.stat_safety],
                ["政策", sections.stat_policy]
              ].map(([label, value], index) => (
                <div key={String(label)} className={`px-4 ${index === 0 ? "pl-0" : ""} ${index < 4 ? "border-r border-border" : ""}`}>
                  <small className="mb-1.5 block font-mono text-[10px] uppercase tracking-[1.2px] text-fg-soft">{String(label)}</small>
                  <b className="block font-mono text-xl font-normal tracking-[-0.3px] text-fg">{text(value, "—")}</b>
                  <span className="font-mono text-[11px] text-fg-muted">24H</span>
                </div>
              ))}
            </section>

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
                  <p className="mb-4 max-w-[76ch] text-base leading-[1.6] text-fg-muted">{content}</p>
                  <div className="grid grid-cols-[minmax(0,1fr)_220px] items-start gap-4 border-b border-hairline pb-4 max-[800px]:grid-cols-1">
                    <div>
                      <h3 className="mb-2 font-display text-2xl font-normal leading-[1.25] tracking-[-0.4px] text-fg">{headlineFor(dim.key)}</h3>
                      <p className="m-0 text-sm leading-[1.55] text-fg-muted">{content}</p>
                    </div>
                    <div className="border border-border bg-surface p-3 font-mono text-[11px] leading-[1.45] tracking-[0.6px] text-fg-soft">
                      <span className="mb-2 inline-flex border border-border bg-bg-deep px-2 py-1 text-lg leading-none tracking-[-0.2px] text-fg">{scoreFor(dim.key)}</span>
                      <b className="mb-1.5 block text-[13px] font-normal text-fg">维度信号</b>
                      FE-Radar · {dim.sub}<br />自动生成 · 人工复核建议
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-5 pt-4 max-[760px]:grid-cols-1">
                    <SmallItem title={`${dim.title}相关信号 A`} body={content} />
                    <SmallItem title={`${dim.title}相关信号 B`} body="建议纳入后续跟踪，并在下次日报中观察变化趋势。" />
                  </div>
                </section>
              );
            })}

            <blockquote className="my-6 max-w-[72ch] border-y border-border py-10">
              <span className="mb-3 block font-display text-[100px] leading-[0.6] text-accent">“</span>
              <q className="font-display text-[28px] leading-[1.3] tracking-[-0.6px] text-fg">信源比信息重要，先精选信源，再处理信息。</q>
              <cite className="mt-4 block font-mono text-[11px] not-italic uppercase tracking-[1.4px] text-fg-soft">FE-Radar operating principle</cite>
            </blockquote>

            <footer className="mt-6 flex flex-wrap justify-between gap-8 border-t-4 border-double border-fg py-12">
              <Col title="分发" body="钉钉群推送 · 邮件订阅 · 内部门户。每日 08:00 自动生成。" />
              <Col title="反馈" body="条目反馈按钮 · 日报评分。管理员调整信源与评分权重。" />
              <Col title="导出" body="PDF 日报 · Excel 数据表。数据保留 90 天。" />
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

function briefs(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function headlineFor(key: string): string {
  return ({ policy: "监管与准入变化值得关注", market: "成本与供需信号同步抬升", tech: "技术路线进入验证窗口", project: "项目招投标保持高活跃", company: "公司与竞品动态需跟踪" } as Record<string, string>)[key] ?? "重点信号";
}

function scoreFor(key: string): number {
  return ({ policy: 86, market: 78, tech: 72, project: 81, company: 74 } as Record<string, number>)[key] ?? 70;
}

function SmallItem({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <article>
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[1.2px] text-fg-soft">brief</div>
      <h4 className="mb-1.5 font-display text-lg font-normal leading-[1.3] tracking-[-0.2px] text-fg">{title}</h4>
      <p className="m-0 line-clamp-3 text-[13px] leading-[1.55] text-fg-muted">{body}</p>
    </article>
  );
}

function Col({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <div>
      <h4 className="mb-2.5 font-mono text-[11px] font-normal uppercase tracking-[1.6px] text-fg-soft">{title}</h4>
      <p className="m-0 max-w-[36ch] text-[13px] leading-[1.55] text-fg-muted">{body}</p>
    </div>
  );
}
