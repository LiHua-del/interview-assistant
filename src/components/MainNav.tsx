"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "概览" },
  { href: "/jobs", label: "岗位" },
  { href: "/candidates", label: "候选人" },
  { href: "/pool", label: "题库" },
];

export function MainNav() {
  const pathname = usePathname();
  return <nav aria-label="主导航" className="flex h-full gap-1 text-sm sm:gap-3">
    {NAV.map(({ href, label }) => {
      const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
      return <Link key={href} href={href} aria-current={active ? "page" : undefined}
        className={`flex items-center border-b-2 px-2 transition-colors sm:px-3 ${active ? "border-emerald-700 bg-emerald-50 font-semibold text-emerald-900" : "border-transparent text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"}`}>
        {label}
      </Link>;
    })}
  </nav>;
}
