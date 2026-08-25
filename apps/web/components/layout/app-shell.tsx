"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Menu, X } from "lucide-react";
import { AlertBadge } from "@/components/layout/alert-badge";
import { getBreadcrumb, getDataNav } from "@/components/layout/nav";
import { CopilotProvider } from "@/components/copilot/copilot-provider";
import { useModalBehavior } from "@/hooks/use-modal-behavior";

import type { NavItem } from "@/components/layout/nav";
import type { UserRole } from "@fe-radar/shared";

const ROLE_WEIGHT: Record<UserRole, number> = { viewer: 1, editor: 2, admin: 3 };

function BrandLogo({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const width = compact ? 96 : 128;
  return (
    <Image
      alt="远东控股集团"
      className={`block h-auto border border-white/[0.18] bg-white px-1 py-0.5 ${compact ? "w-[96px]" : "w-[128px]"}`}
      height={compact ? 19 : 26}
      src="/fareast-logo.png"
      width={width}
    />
  );
}

function canSee(role: UserRole | undefined, minRole: UserRole): boolean {
  return Boolean(role && ROLE_WEIGHT[role] >= ROLE_WEIGHT[minRole]);
}

const MONITOR_NAV: readonly NavItem[] = [
  { href: "/admin/dashboard", label: "概览 Dashboard", minRole: "admin" },
  { href: "/", label: "时间线 Timeline", minRole: "viewer" },
  { href: "/curated", label: "精选 Curated", minRole: "viewer", badge: "count" },
  { href: "/alerts", label: "告警 Alerts", minRole: "viewer", badge: "alert" },
  { href: "/daily", label: "日报 Digest", minRole: "viewer" },
  { href: "/briefing", label: "每日简报 Briefing", minRole: "viewer" },
];

const ADMIN_NAV: readonly NavItem[] = [
  { href: "/admin/sources", label: "信源 Sources", minRole: "editor" as UserRole },
  { href: "/admin/backlog", label: "队列 Backlog", minRole: "admin" as UserRole },
  { href: "/admin/briefing/logs", label: "简报生成日志", minRole: "admin" as UserRole },
  { href: "/admin/briefing/targets", label: "合并日报推送", minRole: "admin" as UserRole },
  { href: "/admin/scoring-config", label: "评分配置 Scoring", minRole: "admin" as UserRole },
  { href: "/admin/worker", label: "运行监控 Monitor", minRole: "admin" as UserRole },
  { href: "/admin/users", label: "用户与权限", minRole: "admin" as UserRole },
];

export function AppShell({
  children,
  copilotEnabled = false,
  user,
  activePath,
}: {
  children: React.ReactNode;
  copilotEnabled?: boolean;
  user?: { name?: string | null; role?: UserRole };
  activePath?: string;
}): React.JSX.Element {
  const pathname = usePathname();
  const currentPath = pathname ?? activePath;
  const isLoggedIn = Boolean(user?.name);
  const initial = user?.name ? user.name.slice(0, 2).toUpperCase() : "?";
  const dataNav = getDataNav(copilotEnabled);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  useModalBehavior({
    onClose: () => setDrawerOpen(false),
    open: drawerOpen,
    panelRef: drawerRef
  });

  return (
    <div className="grid min-h-[100dvh] grid-cols-[188px_1fr] max-shell:block">
      <aside className="sticky top-0 flex h-[100dvh] flex-col overflow-y-auto border-r border-surface-deep bg-surface-deep py-3 text-fg-on-dark max-shell:hidden">
        <div className="px-3 pb-3 border-b border-white/[0.08] mb-2">
          <BrandLogo />
          <small className="mt-1 block text-[10px] text-white/55 tracking-[1.2px] uppercase">FE-Radar</small>
        </div>

        {isLoggedIn ? (
          <nav className="flex-1">
            <NavSection title="监测" items={MONITOR_NAV} role={user?.role} activePath={currentPath} />
            <NavSection title="数据" items={dataNav} role={user?.role} activePath={currentPath} />
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

      <main className="@container min-w-0 [--shell-header-h:2.5rem] max-shell:[--shell-header-h:6.0625rem]">
        <div className="contents max-shell:sticky max-shell:top-0 max-shell:z-30 max-shell:block">
          {isLoggedIn && (
            <div className="hidden items-center justify-between gap-3 border-b border-white/[0.08] bg-surface-deep px-4 py-2 text-fg-on-dark max-shell:flex">
              <BrandLogo compact />
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

          {isLoggedIn && (
            <div className="sticky top-0 z-10 flex min-h-10 items-center justify-between gap-3 border-b border-border bg-bg px-5 py-2 max-shell:static max-shell:px-4">
              <div className="shrink-0 text-[10px] uppercase tracking-[0.4px] text-fg-muted">
                {getBreadcrumb(currentPath)}
              </div>
              <div className="flex items-center">
                <AlertBadge />
              </div>
            </div>
          )}
        </div>

        {isLoggedIn && drawerOpen && (
          <div className="fixed inset-0 z-40 hidden max-shell:block">
            <button
              aria-label="关闭菜单"
              className="absolute inset-0 bg-black/60"
              onClick={() => setDrawerOpen(false)}
              type="button"
            />
            <div
              aria-label="主导航"
              aria-modal="true"
              className="absolute inset-y-0 left-0 flex w-[240px] flex-col overflow-y-auto border-r border-white/[0.08] bg-surface-deep text-fg-on-dark transition-transform duration-200 starting:-translate-x-full"
              ref={drawerRef}
              role="dialog"
            >
              <div className="px-3 py-3 border-b border-white/[0.08] flex items-center justify-between">
                <BrandLogo />
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
                <NavSection title="数据" items={dataNav} role={user?.role} activePath={currentPath} />
                <NavSection title="管理" items={ADMIN_NAV} role={user?.role} activePath={currentPath} />
              </nav>
            </div>
          </div>
        )}

        {isLoggedIn ? (
          <CopilotProvider enabled={copilotEnabled}>{children}</CopilotProvider>
        ) : (
          children
        )}
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
  items: readonly NavItem[];
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
              className={`flex min-h-10 items-center justify-between border-l-2 px-3 py-2 text-[13px] font-medium leading-5 transition-colors lg:min-h-9 lg:py-1.5
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
