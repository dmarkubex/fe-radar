import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { AppShell } from "@/components/layout/app-shell";
import { evaluateCopilotAccess } from "@/lib/api/copilot-access";
import { webLogger } from "@/lib/logger";
import { auth } from "@/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "FE-Radar",
  description: "远东控股产业情报雷达",
};
export const viewport: Viewport = {
  themeColor: "#005b86",
  viewportFit: "cover"
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): Promise<React.JSX.Element> {
  const session = await auth();
  const hdrs = await headers();
  const activePath = hdrs.get("x-pathname") ?? "/";
  const isLoginPage = activePath === "/auth/login";

  let copilotEnabled = false;
  if (session?.user?.id) {
    try {
      copilotEnabled = await evaluateCopilotAccess(Number(session.user.id));
    } catch (err) {
      webLogger.error({ err }, "evaluateCopilotAccess failed");
      copilotEnabled = false;
    }
  }
  void copilotEnabled;

  if (isLoginPage) {
    return (
      <html lang="zh-CN">
        <body>{children}</body>
      </html>
    );
  }

  return (
    <html lang="zh-CN">
      <body>
        <AppShell
          user={{ name: session?.user?.name, role: session?.user?.role }}
          activePath={activePath}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
