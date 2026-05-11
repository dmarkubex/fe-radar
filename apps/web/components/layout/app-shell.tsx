import Link from "next/link";
import { Activity, Bell, FileText, Search, Settings, Star } from "lucide-react";
import { AlertBadge } from "@/components/layout/alert-badge";

import type { UserRole } from "@fe-radar/shared";

const NAV = [
  { href: "/", label: "时间线", icon: Activity, minRole: "viewer" },
  { href: "/curated", label: "精选", icon: Star, minRole: "viewer" },
  { href: "/search", label: "搜索", icon: Search, minRole: "viewer" },
  { href: "/alerts", label: "告警", icon: Bell, minRole: "viewer" },
  { href: "/daily", label: "日报", icon: FileText, minRole: "viewer" },
  { href: "/admin/sources", label: "后台", icon: Settings, minRole: "editor" }
] as const;

const ROLE_WEIGHT: Record<UserRole, number> = { viewer: 1, editor: 2, admin: 3 };

function canSee(role: UserRole | undefined, minRole: UserRole): boolean {
  return Boolean(role && ROLE_WEIGHT[role] >= ROLE_WEIGHT[minRole]);
}

export function AppShell({
  children,
  user
}: {
  children: React.ReactNode;
  user?: { name?: string | null; role?: UserRole };
}): React.JSX.Element {
  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 hidden w-56 border-r border-zinc-200 bg-white px-3 py-4 md:block">
        <div className="px-2 pb-5">
          <p className="text-xs font-medium text-zinc-500">远东控股</p>
          <p className="text-lg font-semibold text-zinc-950">FE-Radar</p>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.filter((item) => canSee(user?.role, item.minRole)).map((item) => (
            <Link className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100" href={item.href} key={item.href}>
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="md:pl-56">
        <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b border-zinc-200 bg-white/95 px-4 backdrop-blur md:px-6">
          <nav className="flex gap-1 md:hidden">
            {NAV.filter((item) => canSee(user?.role, item.minRole)).slice(0, 4).map((item) => (
              <Link className="rounded-md p-2 text-zinc-700 hover:bg-zinc-100" href={item.href} key={item.href} aria-label={item.label}>
                <item.icon className="h-4 w-4" />
              </Link>
            ))}
          </nav>
          <AlertBadge />
          <div className="flex items-center gap-2 text-sm">
            {user?.name ? (
              <div className="rounded-md border border-zinc-200 px-3 py-1.5 text-zinc-700">
                {user.name}
                <span className="ml-2 text-xs text-zinc-400">{user.role}</span>
              </div>
            ) : (
              <Link className="rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white" href="/auth/login">
                登录
              </Link>
            )}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
