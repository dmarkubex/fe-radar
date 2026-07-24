import { and, desc, eq, sql } from "drizzle-orm";
import {
  briefingHolidays,
  commodityBriefings,
  commodityQuotes,
  getDb,
  sources
} from "@fe-radar/db";
import { dayjs, APP_TIMEZONE } from "@fe-radar/shared";
import { ChevronRight, FileText, Clock } from "lucide-react";
import Link from "next/link";
import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";
import { isMockMode } from "@/lib/mock-mode";

export const dynamic = "force-dynamic";

const STATUS_META: Record<string, { label: string; color: string }> = {
  succeeded: { label: "已生成", color: "text-ok" },
  pending: { label: "生成中", color: "text-warn" },
  failed: { label: "生成失败", color: "text-danger" },
  degraded: { label: "降级生成", color: "text-warn" }
};

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const meta = STATUS_META[status] ?? { label: status, color: "text-fg-soft" };
  return (
    <span
      className={`font-mono text-[10px] uppercase tracking-[0.8px] ${meta.color}`}
    >
      {meta.label}
    </span>
  );
}

interface BriefingListRow {
  id: number;
  briefingDate: string;
  genStatus: string;
  genError: string | null;
  generatedAt: Date;
  docxPath: string | null;
}

interface PageDiagnostic {
  tone: "warn" | "danger" | "muted";
  title: string;
  detail: string;
}

function diagnosticClass(tone: PageDiagnostic["tone"]): string {
  if (tone === "danger") return "border-danger/35 bg-danger/5 text-danger";
  if (tone === "warn") return "border-warn/35 bg-warn/5 text-warn";
  return "border-border bg-surface text-fg-soft";
}

async function buildPageDiagnostic(
  db: ReturnType<typeof getDb>,
  rows: BriefingListRow[]
): Promise<PageDiagnostic | null> {
  const now = dayjs().tz(APP_TIMEZONE);
  const todayStr = now.format("YYYY-MM-DD");
  const latest = rows[0] ?? null;
  const quoteStatsDate =
    latest?.genStatus === "failed" ? latest.briefingDate : todayStr;

  const [enabledQuoteSourceRows, holidayRows, latestQuoteRows, quoteStatsRows] =
    await Promise.all([
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(sources)
        .where(
          and(eq(sources.fetcherType, "quotes"), eq(sources.enabled, true))
        ),
      db
        .select({ name: briefingHolidays.name })
        .from(briefingHolidays)
        .where(eq(briefingHolidays.holidayDate, todayStr))
        .limit(1),
      db
        .select({ observedAt: commodityQuotes.observedAt })
        .from(commodityQuotes)
        .orderBy(desc(commodityQuotes.observedAt))
        .limit(1),
      db
        .select({
          total: sql<number>`count(*)::int`,
          nonNull: sql<number>`count(*) filter (where ${commodityQuotes.value} is not null)::int`
        })
        .from(commodityQuotes)
        .where(
          sql`DATE(${commodityQuotes.observedAt} AT TIME ZONE 'Asia/Shanghai') = ${quoteStatsDate}::date`
        )
    ]);

  const enabledQuotesSources = Number(enabledQuoteSourceRows[0]?.value ?? 0);
  const latestQuoteAt = latestQuoteRows[0]?.observedAt ?? null;
  const holidayName = holidayRows[0]?.name ?? null;
  const isWeekend = now.day() === 0 || now.day() === 6;
  const quoteStats = {
    total: Number(quoteStatsRows[0]?.total ?? 0),
    nonNull: Number(quoteStatsRows[0]?.nonNull ?? 0)
  };

  if (enabledQuotesSources === 0) {
    return {
      tone: "warn",
      title: "行情信源未启用",
      detail:
        "当前没有 enabled=true 的 quotes 信源；系统不会自动启用信源，需要后台确认后手动开启。"
    };
  }

  if (latest?.genStatus === "failed") {
    const hasData = quoteStats.nonNull > 0;
    return {
      tone: "danger",
      title: hasData ? "简报生成失败，行情数据已在库" : "简报生成失败",
      detail: hasData
        ? `${latest.briefingDate} 已有 ${quoteStats.nonNull} 条可用行情数据，失败原因：${latest.genError ?? "未记录"}`
        : `${latest.briefingDate} 未检测到非空行情数据，失败原因：${latest.genError ?? "未记录"}`
    };
  }

  if (holidayName || isWeekend) {
    return {
      tone: "muted",
      title: "今日简报已跳过",
      detail: holidayName
        ? `${todayStr} 为节假日（${holidayName}），quotes-fetch / briefing-gen / briefing-push 不写入新数据。`
        : `${todayStr} 为周末，quotes-fetch / briefing-gen / briefing-push 不写入新数据。`
    };
  }

  if (!latestQuoteAt) {
    return {
      tone: "warn",
      title: "行情尚未入库",
      detail: "quotes 信源已启用，但 commodity_quotes 尚无任何行情记录。"
    };
  }

  if (rows.length === 0) {
    return {
      tone: "warn",
      title: "暂无简报数据",
      detail: `已有行情入库，最近行情时间为 ${dayjs(latestQuoteAt).tz(APP_TIMEZONE).format("YYYY-MM-DD HH:mm")}，但尚未生成简报。`
    };
  }

  return null;
}

async function loadBriefingPageData(): Promise<{
  rows: BriefingListRow[];
  diagnostic: PageDiagnostic | null;
}> {
  if (isMockMode()) {
    return {
      rows: [],
      diagnostic: {
        tone: "muted",
        title: "演示模式暂无简报",
        detail:
          "当前运行在 mock 数据模式，铜锂行情简报需要连接业务数据库后展示。"
      }
    };
  }

  try {
    const db = getDb();
    const rows = (await db
      .select({
        id: commodityBriefings.id,
        briefingDate: commodityBriefings.briefingDate,
        genStatus: commodityBriefings.genStatus,
        genError: commodityBriefings.genError,
        generatedAt: commodityBriefings.generatedAt,
        docxPath: commodityBriefings.docxPath
      })
      .from(commodityBriefings)
      .orderBy(desc(commodityBriefings.briefingDate))
      .limit(60)) as BriefingListRow[];

    return { rows, diagnostic: await buildPageDiagnostic(db, rows) };
  } catch (error) {
    console.error("[briefing] list page query failed", error);
    return {
      rows: [],
      diagnostic: {
        tone: "warn",
        title: "简报数据暂不可用",
        detail:
          "数据库连接或简报表结构暂不可用；页面已保留入口，恢复后会自动显示最近 60 期简报。"
      }
    };
  }
}

export default async function BriefingListPage(): Promise<React.JSX.Element> {
  const { rows, diagnostic } = await loadBriefingPageData();

  const RETENTION_DAYS = 90;
  function isExpired(dateStr: string): boolean {
    return dayjs(dateStr)
      .tz(APP_TIMEZONE)
      .isBefore(
        dayjs().tz(APP_TIMEZONE).subtract(RETENTION_DAYS, "day").startOf("day")
      );
  }

  return (
    <PageFrame size="wide">
      <PageHeader
        eyebrow="简报 · BRIEFING"
        title="铜锂行情每日简报"
        description="每个工作日 16:00 自动生成，含沪铜 / 碳酸锂主力行情、宏观评述、风险提示与采购建议。"
      />

      {diagnostic && (
        <div
          className={`mb-4 border px-4 py-3 ${diagnosticClass(diagnostic.tone)}`}
        >
          <div className="text-sm font-medium text-fg">{diagnostic.title}</div>
          <div className="mt-1 text-xs leading-5 text-fg-soft">
            {diagnostic.detail}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="py-20 text-center text-sm text-fg-soft">
          暂无简报数据
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-hairline border border-border rounded-[2px] overflow-hidden">
          {rows.map((row) => {
            const expired = isExpired(row.briefingDate);
            const dateDisplay = dayjs(row.briefingDate)
              .tz(APP_TIMEZONE)
              .format("YYYY 年 M 月 D 日 dddd");
            const generatedAt =
              row.generatedAt instanceof Date
                ? dayjs(row.generatedAt).tz(APP_TIMEZONE).format("HH:mm")
                : "-";
            const canView =
              row.genStatus === "succeeded" || row.genStatus === "degraded";

            return (
              <div
                key={row.id}
                className="group flex items-center justify-between gap-4 bg-surface px-5 py-4 hover:bg-bg-deep transition-colors"
              >
                {/* Left: date + status */}
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-[2px] bg-bg-deep border border-border">
                    <FileText className="h-4 w-4 text-fg-soft" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-fg truncate">
                      {dateDisplay}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StatusBadge status={row.genStatus} />
                      {generatedAt !== "-" && (
                        <span className="font-mono text-[10px] text-fg-soft flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          生成于 {generatedAt}
                        </span>
                      )}
                      {row.genStatus === "failed" && row.genError && (
                        <details className="min-w-0 font-mono text-[10px] text-danger">
                          <summary className="cursor-pointer">失败原因</summary>
                          <p className="mt-1 max-w-[48ch] break-words leading-4" title={row.genError}>{row.genError}</p>
                        </details>
                      )}
                      {expired && row.docxPath && (
                        <span className="font-mono text-[10px] text-fg-soft">
                          · docx 已过保留期
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: action */}
                <div className="flex-shrink-0">
                  {canView ? (
                    <Link
                      href={`/briefing/${row.id}`}
                      className="flex min-h-11 items-center gap-1 font-mono text-[12px] text-accent transition-colors hover:text-accent-flame"
                    >
                      查看详情
                      <ChevronRight className="h-3 w-3" />
                    </Link>
                  ) : (
                    <span className="text-[11px] text-fg-soft font-mono">
                      {row.genStatus === "pending" ? "生成中…" : "不可用"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PageFrame>
  );
}
