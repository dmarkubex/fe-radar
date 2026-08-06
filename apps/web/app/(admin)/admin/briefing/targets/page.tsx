import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ScheduleForm } from "@/components/briefing/schedule-form";
import { TargetTable } from "@/components/briefing/target-table";
import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";

async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/login?callbackUrl=/admin/briefing/targets");
  }
  if (session.user.role !== "admin") redirect("/");
}

export default async function AdminBriefingTargetsPage(): Promise<React.JSX.Element> {
  await requireAdmin();

  return (
    <PageFrame size="full">
      <PageHeader
        eyebrow="/ 合并日报推送 · ADMIN · DAILY · PUSH"
        title="合并日报推送"
        description="配置合并日报定时发送（产业日报 + 铜锂简报 ActionCard），并管理钉钉群机器人目标；测试推送发送真实深链卡片。"
      />
      <div className="space-y-6">
        <ScheduleForm />
        <TargetTable />
      </div>
    </PageFrame>
  );
}
