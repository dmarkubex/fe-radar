import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TargetTable } from "@/components/briefing/target-table";

// Server-side RBAC guard (second layer after middleware)
async function requireAdmin(): Promise<void> {
  const headersList = await headers();
  // next-auth token is available server-side via cookies forwarded through headers
  // We check role from the session cookie using next-auth JWT
  const cookieHeader = headersList.get("cookie") ?? "";
  const sessionCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("fe-radar.session-token="));

  if (!sessionCookie) {
    redirect("/auth/login?callbackUrl=/admin/briefing/targets");
  }
}

export default async function AdminBriefingTargetsPage(): Promise<React.JSX.Element> {
  await requireAdmin();

  return (
    <main className="min-h-screen bg-bg px-6 py-8 font-body text-fg">
      <div className="mx-auto w-full max-w-7xl space-y-8">
        <header className="space-y-2">
          <p className="font-mono text-xs tracking-wide text-fg-soft uppercase">
            / 简报推送目标 · ADMIN · BRIEFING · TARGETS
          </p>
          <h1 className="font-display text-3xl tracking-tightest text-fg">
            推送目标管理
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-fg-muted">
            管理钉钉群机器人推送目标，新增 / 编辑 / 停用推送接收方，并可发送测试消息验证配置。
          </p>
        </header>
        <TargetTable />
      </div>
    </main>
  );
}
