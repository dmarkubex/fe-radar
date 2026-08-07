import { desc, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { commodityBriefings, getDb } from "@fe-radar/db";
import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";
import { isMockMode } from "@/lib/mock-mode";

export const dynamic = "force-dynamic";

export default async function BriefingPage(): Promise<React.JSX.Element> {
  let latestId: number | undefined;

  if (!isMockMode()) {
    try {
      const [latest] = await getDb()
        .select({ id: commodityBriefings.id })
        .from(commodityBriefings)
        .where(inArray(commodityBriefings.genStatus, ["succeeded", "degraded"]))
        .orderBy(desc(commodityBriefings.briefingDate))
        .limit(1);
      latestId = latest?.id;
    } catch (error) {
      console.error("[briefing] latest briefing query failed", error);
    }
  }

  if (latestId) redirect(`/briefing/${latestId}`);

  return (
    <PageFrame size="wide">
      <PageHeader
        eyebrow="简报 · BRIEFING"
        title="铜锂行情每日简报"
        description="每个工作日 16:00 自动生成，生成后可直接查看今日简报。"
      />
      <div className="py-20 text-center text-sm text-fg-soft">暂无可查看的简报</div>
    </PageFrame>
  );
}
