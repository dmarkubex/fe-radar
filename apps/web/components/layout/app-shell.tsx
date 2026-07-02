"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Menu, X } from "lucide-react";
import { AlertBadge } from "@/components/layout/alert-badge";
import { useModalBehavior } from "@/hooks/use-modal-behavior";

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
  { href: "/admin/worker", label: "运行监控 Monitor", minRole: "admin" as UserRole },
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  useModalBehavior({
    onClose: () => setDrawerOpen(false),
    open: drawerOpen,
    panelRef: drawerRef
  });

  return (
    <div className="grid grid-cols-[188px_1fr] min-h-screen max-[760px]:block">
      <aside className="bg-surface-deep text-fg-on-dark py-3 border-r border-surface-deep sticky top-0 h-screen overflow-y-auto flex flex-col max-[760px]:hidden">
        <div className="px-3 pb-3 border-b border-white/[0.08] mb-2">
          <img
            src="/fareast-logo.png"
            alt="远东控股集团"
            className="block h-auto w-[128px] border border-white/[0.18] bg-white px-1 py-0.5"
          />
          <small className="mt-1 block text-[10px] text-white/55 tracking-[1.2px] uppercase">FE-Radar</small>
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
          <div className="mt-auto px-3 py-3 border-t border-white/[0.08] flex items-center justify-between gap-2 text-xs text-white/60">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 bg-sunshine-700 text-white grid place-items-center text-[10px] tracking-[-0.5px] rounded-[1px] shrink-0">
                {initial}
              </div>
              <div className="min-w-0">
                <div className="text-white text-xs truncate">{user?.name}</div>
                <small className="text-white/50 text-[10px]">
                  {user?.role === "admin" ? "管理员" : user?.role === "editor" ? "编辑" : "查看者"}
                </small>
              </div>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/auth/login" })}
              className="text-[11px] tracking-[0.5px] uppercase text-white/50 hover:text-white/90 transition-colors px-2 py-1.5 min-h-[36px] border border-white/20 hover:border-white/40 rounded-[1px]"
            >
              登出
            </button>
          </div>
        )}
      </aside>

      <main className="@container min-w-0">
        {isLoggedIn && (
          <div className="hidden max-[760px]:flex items-center justify-between gap-3 px-4 py-2 bg-surface-deep text-fg-on-dark border-b border-white/[0.08] sticky top-0 z-30">
            <img
              src="/fareast-logo.png"
              alt="远东控股集团"
              className="block h-auto w-[96px] border border-white/[0.18] bg-white px-1 py-0.5"
            />
            <button
              type="button"
              aria-label="打开菜单"
              onClick={() => setDrawerOpen(true)}
              className="grid place-items-center w-10 h-10 border border-white/20 text-white/80 hover:text-white hover:border-white/40 rounded-[1px] transition-colors"
            >
              <Menu className="w-4 h-4" />
            </button>
          </div>
        )}

        {isLoggedIn && drawerOpen && (
          <div className="hidden max-[760px]:block fixed inset-0 z-40">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setDrawerOpen(false)}
            />
            <div ref={drawerRef} className="absolute inset-y-0 left-0 w-[240px] bg-surface-deep text-fg-on-dark flex flex-col overflow-y-auto border-r border-white/[0.08]">
              <div className="px-3 py-3 border-b border-white/[0.08] flex items-center justify-between">
                <img
                  src="/fareast-logo.png"
                  alt="远东控股集团"
                  className="block h-auto w-[128px] border border-white/[0.18] bg-white px-1 py-0.5"
                />
                <button
                  type="button"
                  aria-label="关闭菜单"
                  onClick={() => setDrawerOpen(false)}
                  className="grid place-items-center w-10 h-10 border border-white/20 text-white/80 hover:text-white hover:border-white/40 rounded-[1px] transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <nav className="flex-1 py-2" onClick={() => setDrawerOpen(false)}>
                <NavSection title="监测" items={MONITOR_NAV} role={user?.role} activePath={currentPath} />
                <NavSection title="数据" items={DATA_NAV} role={user?.role} activePath={currentPath} />
                <NavSection title="管理" items={ADMIN_NAV} role={user?.role} activePath={currentPath} />
              </nav>
            </div>
          </div>
        )}

        {isLoggedIn && (
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-2 bg-bg border-b border-border max-[760px]:px-4">
            <div className="text-[10px] text-fg-muted tracking-[0.4px] uppercase shrink-0 max-[760px]:hidden">
              {getBreadcrumb(currentPath)}
            </div>
            <div className="flex items-center">
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
      <div className="px-3 pt-3 pb-1 text-[10px] tracking-[1.2px] uppercase text-white/50">
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
              className={`flex items-center justify-between px-3 py-1.5 text-[13px] font-medium leading-5 border-l-2 transition-colors
                ${isActive
                  ? "bg-white/15 text-white border-l-sunshine-500"
                  : "text-white/86 border-l-transparent hover:bg-white/10 hover:text-white hover:border-l-sunshine-500/80"
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
  if (path.startsWith("/admin/worker")) return "管理 / 运行监控";
  if (path.startsWith("/admin/users")) return "管理 / 用户";
  if (path.startsWith("/admin/entities")) return "数据 / 实体";
  if (path.startsWith("/briefing")) return "监测 / 简报";
  return "";
}
