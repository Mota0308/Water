import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "每日工作流程管理系統",
  description: "門市及國內倉每日工作流程管理系統",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
