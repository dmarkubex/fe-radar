"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertBadge } from "@/components/layout/alert-badge";

import type { UserRole } from "@fe-radar/shared";

const ROLE_WEIGHT: Record<UserRole, number> = { viewer: 1, editor: 2, admin: 3 };

function canSee(role: UserRole | undefined, minRole: UserRole): boolean {
  return Boolean(role && ROLE_WEIGHT[role] >= ROLE_WEIGHT[minRole]);
}

const MONITOR_NAV = [
  { href: "/admin/dashboard", label: "概览 Dashboard", minRole: "viewer" as UserRole },
  { href: "/", label: "时间线 Timeline", minRole: "viewer" as UserRole },
  { href: "/curated", label: "精选 Curated", minRole: "viewer" as UserRole, badge: "count" },
  { href: "/alerts", label: "告警 Alerts", minRole: "viewer" as UserRole, badge: "alert" },
  { href: "/daily", label: "日报 Digest", minRole: "viewer" as UserRole },
  { href: "/briefing", label: "每日简报 Briefing", minRole: "viewer" as UserRole },
];

const DATA_NAV = [
  { href: "/items", label: "条目查询", minRole: "viewer" as UserRole },
  { href: "/admin/entities", label: "实体库", minRole: "editor" as UserRole },
];

const ADMIN_NAV = [
  { href: "/admin/sources", label: "信源 Sources", minRole: "editor" as UserRole },
  { href: "/admin/scoring-config", label: "评分配置 Scoring", minRole: "admin" as UserRole },
  { href: "/admin/users", label: "用户与权限", minRole: "admin" as UserRole },
];

export function AppShell({
  children,
  user,
  activePath,
}: {
  children: React.ReactNode;
  user?: { name?: string | null; role?: UserRole };
  activePath?: string;
}): React.JSX.Element {
  const pathname = usePathname();
  const currentPath = pathname ?? activePath;
  const isLoggedIn = Boolean(user?.name);
  const initial = user?.name ? user.name.slice(0, 2).toUpperCase() : "?";

  return (
    <div className="grid grid-cols-[232px_1fr] min-h-screen max-[760px]:grid-cols-1">
      <aside className="bg-surface-deep text-fg-on-dark py-6 border-r border-surface-deep sticky top-0 h-screen overflow-y-auto flex flex-col max-[760px]:static max-[760px]:h-auto">
        <div className="px-6 pb-6 border-b border-white/[0.08] mb-4">
          <img
            src="/fareast-logo.png"
            alt="远东控股集团"
            className="block h-auto w-[158px] border border-white/[0.18] bg-white px-2 py-1"
          />
          <small className="mt-2 block text-[10px] text-white/55 tracking-[1.6px] uppercase">FE-Radar · 行业情报雷达</small>
        </div>

        {isLoggedIn ? (
          <nav className="flex-1">
            <NavSection title="监测" items={MONITOR_NAV} role={user?.role} activePath={currentPath} />
            <NavSection title="数据" items={DATA_NAV} role={user?.role} activePath={currentPath} />
            <NavSection title="管理" items={ADMIN_NAV} role={user?.role} activePath={currentPath} />
          </nav>
        ) : (
          <nav className="flex-1">
            <div className="px-6 py-4">
              <Link href="/auth/login" className="text-sm text-white/80 hover:text-white">
                登录 →
              </Link>
            </div>
          </nav>
        )}

        {isLoggedIn && (
          <div className="mt-auto px-6 py-4 border-t border-white/[0.08] flex items-center gap-2.5 text-xs text-white/60">
            <div className="w-7 h-7 bg-sunshine-700 text-white grid place-items-center text-xs tracking-[-0.5px] rounded-[1px]">
              {initial}
            </div>
            <div>
              <div className="text-white text-sm">{user?.name}</div>
              <small className="text-white/50">
                {user?.role === "admin" ? "管理员" : user?.role === "editor" ? "编辑" : "查看者"}
              </small>
            </div>
          </div>
        )}
      </aside>

      <main className="min-w-0">
        {isLoggedIn && (
          <div className="sticky top-0 z-10 flex items-center gap-4 px-8 py-3.5 bg-bg border-b border-border">
            <div className="text-xs text-fg-muted tracking-[0.4px] uppercase">
              {getBreadcrumb(currentPath)}
            </div>
            <div className="flex-1 max-w-[480px] flex items-center gap-2 bg-surface border border-border px-3 py-[7px] text-[13px] text-fg-soft">
              <span>⌕</span>
              <input placeholder="搜索条目、实体、信源…" className="flex-1 border-0 bg-transparent outline-none text-fg font-[inherit]" />
              <kbd className="font-mono text-[10px] bg-surface border border-border px-[5px] py-[1px] text-fg-muted tracking-[0.4px]">⌘K</kbd>
            </div>
            <div className="flex items-center gap-3">
              <AlertBadge />
            </div>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

function NavSection({
  title,
  items,
  role,
  activePath,
}: {
  title: string;
  items: readonly { href: string; label: string; minRole: UserRole; badge?: string }[];
  role?: UserRole;
  activePath?: string;
}): React.JSX.Element {
  const visible = items.filter((item) => canSee(role, item.minRole));
  if (visible.length === 0) return <></>;

  return (
    <>
      <div className="px-6 pt-4 pb-1.5 text-[10px] tracking-[1.6px] uppercase text-white/40">
        {title}
      </div>
      <nav>
        {visible.map((item) => {
          const isActive =
            activePath === item.href ||
            (item.href === "/" && activePath === "/") ||
            (item.href !== "/" && activePath?.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between px-6 py-2.5 text-sm border-l-2
                ${isActive
                  ? "bg-sunshine-700/18 text-white border-l-accent"
                  : "text-white/82 border-l-transparent hover:bg-white/[0.04] hover:text-white"
                }`}
            >
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function getBreadcrumb(path?: string): string {
  if (!path || path === "/") return "监测 / 时间线";
  if (path.startsWith("/admin/dashboard")) return "监测 / 概览";
  if (path.startsWith("/curated")) return "监测 / 精选";
  if (path.startsWith("/alerts")) return "监测 / 告警";
  if (path.startsWith("/daily")) return "监测 / 日报";
  if (path.startsWith("/items")) return "数据 / 详情";
  if (path.startsWith("/search")) return "监测 / 搜索";
  if (path.startsWith("/admin/sources")) return "管理 / 信源";
  if (path.startsWith("/admin/scoring-config")) return "管理 / 评分配置";
  if (path.startsWith("/admin/users")) return "管理 / 用户";
  if (path.startsWith("/admin/entities")) return "数据 / 实体";
  if (path.startsWith("/briefing")) return "监测 / 简报";
  return "";
}
