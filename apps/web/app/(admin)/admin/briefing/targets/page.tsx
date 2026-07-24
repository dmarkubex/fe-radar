import { redirect } from "next/navigation";
import { auth } from "@/auth";
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
        eyebrow="/ 简报推送目标 · ADMIN · BRIEFING · TARGETS"
        title="推送目标管理"
        description="管理钉钉群机器人推送目标，新增 / 编辑 / 停用推送接收方，并可发送测试消息验证配置。"
      />
      <TargetTable />
    </PageFrame>
  );
}
