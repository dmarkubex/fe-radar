/**
 * S3a: admin 统一新鲜度闸门。
 * 覆盖 (admin)/** 下全部 Server Component 页面；Node runtime 查库，
 * 不进入 Edge middleware（middleware 只解析 JWT 内旧角色是有意设计）。
 */
import { redirect } from "next/navigation";
import { gateAdminPage } from "@/lib/auth/token-freshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminGroupLayout({
  children
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const gate = await gateAdminPage();

  if (!gate.ok) {
    if (gate.kind === "unauthenticated" || gate.kind === "revoked") {
      redirect("/auth/login?callbackUrl=/admin");
    }
    // forbidden（角色不足 / 降权）
    return (
      <div role="main">
        <h1>403 · 权限不足</h1>
        <p>当前账号无权访问此后台页面，或会话已失效。</p>
        <a href="/">返回首页</a>
      </div>
    );
  }

  return <>{children}</>;
}
