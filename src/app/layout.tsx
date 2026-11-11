import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { MainNav } from "@/components/MainNav";

export const metadata: Metadata = {
  title: "面试辅助",
  description: "简历出题与面试复盘",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto max-w-6xl px-3 sm:px-6 h-14 flex items-center gap-3 sm:gap-8">
            <Link href="/" className="shrink-0 font-semibold tracking-tight">
              面试辅助
            </Link>
            <MainNav />
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
