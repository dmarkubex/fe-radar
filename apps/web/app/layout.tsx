import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FE-Radar",
  description: "远东控股产业情报雷达"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
