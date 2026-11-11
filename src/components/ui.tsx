import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-neutral-200 bg-white p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between mb-3">
      <h2 className="text-lg font-semibold">{children}</h2>
      {hint && <span className="text-xs text-neutral-500">{hint}</span>}
    </div>
  );
}

export function CollapsibleCard({ title, hint, children, defaultOpen = false }: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return <details open={defaultOpen} className="group/section self-start rounded-lg border border-neutral-200 bg-white">
    <summary className="cursor-pointer rounded-lg px-5 py-4 marker:text-neutral-400 hover:bg-neutral-50">
      <span className="inline-flex w-[calc(100%-1.25rem)] flex-wrap items-center gap-x-3 gap-y-1 align-middle">
        <span className="text-lg font-semibold">{title}</span>
        {hint && <span className="text-xs text-neutral-500">{hint}</span>}
        <span className="ml-auto text-xs text-neutral-500"><span className="group-open/section:hidden">展开</span><span className="hidden group-open/section:inline">收起</span></span>
      </span>
    </summary>
    <div className="border-t border-neutral-100 p-5">{children}</div>
  </details>;
}

const TONE: Record<string, string> = {
  neutral: "bg-neutral-100 text-neutral-700 border-neutral-200",
  red: "bg-red-50 text-red-700 border-red-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  purple: "bg-purple-50 text-purple-700 border-purple-200",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof TONE;
}) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: keyof typeof TONE;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${TONE[tone].split(" ")[1]}`}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-neutral-400">{hint}</div>}
    </div>
  );
}
