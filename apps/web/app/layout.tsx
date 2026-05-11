import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { auth } from "@/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "FE-Radar",
  description: "远东控股产业情报雷达"
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>): Promise<React.JSX.Element> {
  const session = await auth();
  return (
    <html lang="zh-CN">
      <body>
        <AppShell user={{ name: session?.user?.name, role: session?.user?.role }}>{children}</AppShell>
      </body>
    </html>
  );
}
