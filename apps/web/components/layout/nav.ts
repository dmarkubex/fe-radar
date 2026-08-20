import type { UserRole } from "@fe-radar/shared";

export interface NavItem {
  href: string;
  label: string;
  minRole: UserRole;
  badge?: string;
}

export const DATA_NAV: readonly NavItem[] = [
  { href: "/items", label: "条目查询", minRole: "viewer" },
  { href: "/search", label: "全文搜索", minRole: "viewer" },
  { href: "/admin/entities", label: "实体库", minRole: "editor" },
];

const ASK_NAV_ITEM: NavItem = { href: "/ask", label: "问答", minRole: "viewer" };

/** 灰度开启时数据区加「问答」（与「条目查询」并列），否则不含 */
export function getDataNav(copilotEnabled: boolean): readonly NavItem[] {
  if (!copilotEnabled) return DATA_NAV;
  return [DATA_NAV[0]!, ASK_NAV_ITEM, ...DATA_NAV.slice(1)];
}

export function getBreadcrumb(path?: string): string {
  if (!path || path === "/") return "监测 / 时间线";
  if (path.startsWith("/admin/dashboard")) return "监测 / 概览";
  if (path.startsWith("/ask")) return "数据 / 问答";
  if (path.startsWith("/curated")) return "监测 / 精选";
  if (path.startsWith("/alerts")) return "监测 / 告警";
  if (path.startsWith("/daily")) return "监测 / 日报";
  if (path.startsWith("/items")) return "数据 / 详情";
  if (path.startsWith("/search")) return "监测 / 搜索";
  if (path.startsWith("/admin/sources")) return "管理 / 信源";
  if (path.startsWith("/admin/backlog")) return "管理 / Backlog";
  if (path.startsWith("/admin/briefing/logs")) return "管理 / 简报生成日志";
  if (path.startsWith("/admin/briefing/targets")) return "管理 / 简报推送";
  if (path.startsWith("/admin/scoring-config")) return "管理 / 评分配置";
  if (path.startsWith("/admin/worker")) return "管理 / 运行监控";
  if (path.startsWith("/admin/users")) return "管理 / 用户";
  if (path.startsWith("/admin/entities")) return "数据 / 实体";
  if (path.startsWith("/briefing")) return "监测 / 简报";
  return "";
}
