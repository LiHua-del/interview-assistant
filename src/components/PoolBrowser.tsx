"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";

type Item = {
  id: string;
  category: string;
  tags: string[];
  question: string;
  answer: string;
  difficulty: number;
  duplicates: number;
  favorite: boolean;
};

export function PoolBrowser({
  items,
  categories,
  total,
  favoriteCount,
  keyword,
  category,
  favoritesOnly,
  page,
  pageCount,
  filteredCount,
}: {
  items: Item[];
  categories: { name: string; count: number }[];
  total: number;
  favoriteCount: number;
  keyword: string;
  category: string;
  favoritesOnly: boolean;
  page: number;
  pageCount: number;
  filteredCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(keyword);
  const [openId, setOpenId] = useState<string | null>(null);
  const [favPending, setFavPending] = useState<Set<string>>(new Set());
  // 乐观更新：点击后立刻反馈，请求失败再回滚
  const [favOverride, setFavOverride] = useState<Record<string, boolean>>({});

  function navigate(next: {
    q?: string;
    c?: string;
    f?: boolean;
    p?: number;
  }) {
    const params = new URLSearchParams();
    const q = next.q ?? keyword;
    const c = next.c ?? category;
    const f = next.f ?? favoritesOnly;
    const p = next.p ?? page;
    if (q) params.set("q", q);
    if (c) params.set("c", c);
    if (f) params.set("f", "1");
    if (p > 0) params.set("p", String(p + 1));
    startTransition(() => router.push(`/pool?${params.toString()}`));
  }

  async function toggleFavorite(item: Item) {
    const current = favOverride[item.id] ?? item.favorite;
    const next = !current;
    setFavOverride((m) => ({ ...m, [item.id]: next }));
    setFavPending((s) => new Set(s).add(item.id));

    try {
      const res = await fetch(`/api/pool/${item.id}/favorite`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: next }),
      });
      if (!res.ok) throw new Error();
      startTransition(() => router.refresh());
    } catch {
      setFavOverride((m) => ({ ...m, [item.id]: current }));
    } finally {
      setFavPending((s) => {
        const n = new Set(s);
        n.delete(item.id);
        return n;
      });
    }
  }

  const activeCategory = category || "全部";

  // details 的 open 是属性不是类，lg:open 无效，会导致桌面端也折叠。
  // 改为：桌面默认展开且不可折叠；小屏可折叠。
  const [catOpen, setCatOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* 左栏：分类导航。小屏折叠成一行，大屏始终展开 */}
      <aside className="lg:sticky lg:top-4 lg:w-56 lg:shrink-0">
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <button
            type="button"
            onClick={() => setCatOpen((v) => !v)}
            aria-expanded={catOpen}
            className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium hover:bg-neutral-50 lg:cursor-default lg:hover:bg-transparent"
          >
            <span>
              分类
              <span className="ml-1.5 text-xs font-normal text-neutral-500">
                {favoritesOnly ? "收藏" : activeCategory} · {filteredCount} 道
              </span>
            </span>
            <span className="text-xs text-neutral-400 lg:hidden">
              {catOpen ? "收起" : "展开"}
            </span>
          </button>
          <nav
            className={`${catOpen ? "block" : "hidden"} border-t border-neutral-100 lg:block`}
          >
            <SidebarItem
              label="全部题目"
              count={total}
              active={activeCategory === "全部" && !favoritesOnly}
              onClick={() => navigate({ c: "", f: false, p: 0 })}
            />
            <SidebarItem
              label="★ 收藏"
              count={favoriteCount}
              active={favoritesOnly}
              tone="amber"
              onClick={() => navigate({ f: !favoritesOnly, p: 0 })}
            />
            <div className="border-t border-neutral-100" />
            {categories.map((c) => (
              <SidebarItem
                key={c.name}
                label={c.name}
                count={c.count}
                active={activeCategory === c.name && !favoritesOnly}
                onClick={() => navigate({ c: c.name, f: false, p: 0 })}
              />
            ))}
          </nav>
        </div>
        {pending && (
          <p className="mt-2 px-1 text-xs text-neutral-400">加载中…</p>
        )}
      </aside>

      {/* 右栏：检索与题目列表 */}
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") navigate({ q: draft, p: 0 });
            }}
            placeholder="搜索题目、标签或答案"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm sm:w-80"
          />
          <button
            onClick={() => navigate({ q: draft, p: 0 })}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
          >
            搜索
          </button>
          {(keyword || category || favoritesOnly) && (
            <button
              onClick={() =>
                navigate({ q: "", c: "", f: false, p: 0 })
              }
              className="text-xs text-neutral-500 underline hover:text-neutral-800"
            >
              清除筛选
            </button>
          )}
          <span className="ml-auto text-xs text-neutral-500">
            {filteredCount} 道
          </span>
        </div>

        <div className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          {items.map((it) => {
            const open = openId === it.id;
            const fav = favOverride[it.id] ?? it.favorite;
            return (
              <div key={it.id}>
                <div className="flex items-start gap-2 px-4 py-3 hover:bg-neutral-50">
                  <button
                    onClick={() => toggleFavorite(it)}
                    disabled={favPending.has(it.id)}
                    aria-label={fav ? "取消收藏" : "收藏"}
                    aria-pressed={fav}
                    // 点击目标按 44×44 的触摸标准做内边距，视觉上仍是小星标
                    className={`-m-2 mt-0 shrink-0 rounded p-2 text-base leading-none transition-colors ${
                      fav
                        ? "text-amber-500 hover:bg-amber-50 hover:text-amber-600"
                        : "text-neutral-300 hover:bg-neutral-100 hover:text-amber-400"
                    } disabled:opacity-50`}
                  >
                    {fav ? "★" : "☆"}
                  </button>

                  <button
                    onClick={() => setOpenId(open ? null : it.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="text-sm leading-relaxed">{it.question}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-400">
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600">
                        {it.category}
                      </span>
                      <span>难度 {it.difficulty}</span>
                      {it.duplicates > 0 && (
                        <span className="text-amber-600">
                          被 {it.duplicates + 1} 份题集收录
                        </span>
                      )}
                      {it.tags.slice(0, 4).map((t) => (
                        <span key={t}>#{t}</span>
                      ))}
                    </div>
                  </button>

                  <span className="mt-0.5 shrink-0 text-xs text-neutral-300">
                    {open ? "收起" : "展开"}
                  </span>
                </div>

                {open && (
                  <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-3 pl-11">
                    <p className="prose-block whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">
                      {it.answer}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
          {items.length === 0 && (
            <p className="px-4 py-12 text-center text-sm text-neutral-500">
              没有匹配的题目
            </p>
          )}
        </div>

        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              onClick={() => navigate({ p: Math.max(0, page - 1) })}
              disabled={page === 0 || pending}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40"
            >
              上一页
            </button>
            <span className="text-sm text-neutral-600">
              {page + 1} / {pageCount}
            </span>
            <button
              onClick={() => navigate({ p: Math.min(pageCount - 1, page + 1) })}
              disabled={page >= pageCount - 1 || pending}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarItem({
  label,
  count,
  active,
  onClick,
  tone = "neutral",
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: "neutral" | "amber";
}) {
  const activeCls =
    tone === "amber"
      ? "border-amber-500 bg-amber-50 text-amber-900"
      : "border-emerald-700 bg-emerald-50 text-emerald-900";
  return (
    <button
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-center justify-between border-l-[3px] px-3 py-2 text-left text-sm transition-colors ${
        active
          ? `${activeCls} font-medium`
          : "border-transparent text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
      }`}
    >
      <span className="truncate">{label}</span>
      <span
        className={`ml-2 shrink-0 text-xs tabular-nums ${
          active ? "opacity-70" : "text-neutral-400"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
