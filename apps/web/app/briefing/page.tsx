import { desc } from "drizzle-orm";
import { commodityBriefings, getDb } from "@fe-radar/db";
import { dayjs, APP_TIMEZONE } from "@fe-radar/shared";
import { ChevronRight, FileText, Clock } from "lucide-react";
import Link from "next/link";
import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";

const STATUS_META: Record<string, { label: string; color: string }> = {
  succeeded: { label: "已生成", color: "text-ok" },
  pending:   { label: "生成中", color: "text-warn" },
  failed:    { label: "生成失败", color: "text-danger" },
  degraded:  { label: "降级生成", color: "text-warn" },
};

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const meta = STATUS_META[status] ?? { label: status, color: "text-fg-soft" };
  return (
    <span className={`font-mono text-[10px] uppercase tracking-[0.8px] ${meta.color}`}>
      {meta.label}
    </span>
  );
}

export default async function BriefingListPage(): Promise<React.JSX.Element> {
  const db = getDb();
  const rows = await db
    .select({
      id: commodityBriefings.id,
      briefingDate: commodityBriefings.briefingDate,
      genStatus: commodityBriefings.genStatus,
      generatedAt: commodityBriefings.generatedAt,
      docxPath: commodityBriefings.docxPath,
    })
    .from(commodityBriefings)
    .orderBy(desc(commodityBriefings.briefingDate))
    .limit(60);

  const RETENTION_DAYS = 90;
  function isExpired(dateStr: string): boolean {
    return dayjs(dateStr).tz(APP_TIMEZONE).isBefore(
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

      {rows.length === 0 ? (
        <div className="py-20 text-center text-sm text-fg-soft">
          暂无简报数据
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-hairline border border-border rounded-[2px] overflow-hidden">
          {rows.map((row) => {
            const expired = isExpired(row.briefingDate);
            const dateDisplay = dayjs(row.briefingDate).tz(APP_TIMEZONE).format("YYYY 年 M 月 D 日 dddd");
            const generatedAt = row.generatedAt instanceof Date
              ? dayjs(row.generatedAt).tz(APP_TIMEZONE).format("HH:mm")
              : "-";
            const canView = row.genStatus === "succeeded" || row.genStatus === "degraded";

            return (
              <div key={row.id} className="group flex items-center justify-between gap-4 bg-surface px-5 py-4 hover:bg-bg-deep transition-colors">
                {/* Left: date + status */}
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-[2px] bg-bg-deep border border-border">
                    <FileText className="h-4 w-4 text-fg-soft" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-fg truncate">{dateDisplay}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StatusBadge status={row.genStatus} />
                      {generatedAt !== "-" && (
                        <span className="font-mono text-[10px] text-fg-soft flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          生成于 {generatedAt}
                        </span>
                      )}
                      {expired && row.docxPath && (
                        <span className="font-mono text-[10px] text-fg-soft">· docx 已过保留期</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: action */}
                <div className="flex-shrink-0">
                  {canView ? (
                    <Link
                      href={`/briefing/${row.id}`}
                      className="flex items-center gap-1 text-[12px] text-accent hover:text-accent-flame transition-colors font-mono"
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
