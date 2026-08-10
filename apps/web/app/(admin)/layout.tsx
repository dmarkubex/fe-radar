/**
 * S3a / A-5: admin 统一新鲜度闸门。
 * 覆盖 (admin)/** 下全部 Server Component 页面；Node runtime 查库，
 * 不进入 Edge middleware（middleware 只解析 JWT 内旧角色是有意设计）。
 *
 * 角色要求与 middleware 对齐：`gateAdminPage` 读 `x-pathname`，
 * 用 middleware 导出的 `requiredAdminPageRole`（单一权威）——
 * `/admin/entities` `/admin/sources` → editor，其余 admin 页 → admin。
 *
 * 使用 createElement 而非 JSX：web vitest 未挂 React JSX 转换（jsx:preserve），
 * 直接测 layout 时必须可被 import-analysis 解析（A-5 / A-11）。
 */
import { createElement, Fragment, type ReactNode, type ReactElement } from "react";
import { redirect } from "next/navigation";
import { gateAdminPage } from "@/lib/auth/token-freshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminGroupLayout({
  children
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  // 直接测 layout 时若删掉本行 gate，editor 越权/停用账号测试必须变红（A-5 / A-11）。
  const gate = await gateAdminPage();

  if (!gate.ok) {
    if (gate.kind === "unauthenticated" || gate.kind === "revoked") {
      redirect("/auth/login?callbackUrl=/admin");
    }
    // forbidden（角色不足 / 降权）
    return createElement(
      "div",
      { role: "main" },
      createElement("h1", null, "403 · 权限不足"),
      createElement("p", null, "当前账号无权访问此后台页面，或会话已失效。"),
      createElement("a", { href: "/" }, "返回首页")
    );
  }

  return createElement(Fragment, null, children);
}
