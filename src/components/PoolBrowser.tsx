"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnswerBody } from "@/components/AnswerBody";
import { SplitView, useMediaQuery } from "@/components/SplitView";

type Item = {
  id: string;
  category: string;
  tags: string[];
  question: string;
  answer: string;
  /** 0 = 原始 PDF 内容，1 = 模型重生成过。决定答案用哪套解析器 */
  regenVersion: number;
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
  // 大屏右栏需要默认有内容，但小屏一进来就展开长答案会把列表挤出首屏。
  // 初始置空，挂载后确认是大屏才选中第一题，避免水合不一致。
  const [openId, setOpenId] = useState<string | null>(null);
  const [favPending, setFavPending] = useState<Set<string>>(new Set());
  // 乐观更新：点击后立刻反馈，请求失败再回滚
  const [favOverride, setFavOverride] = useState<Record<string, boolean>>({});
  const answerRef = useRef<HTMLDivElement>(null);
  const [catOpen, setCatOpen] = useState(false);

  // 大屏右栏需要默认有内容；小屏一进来展开长答案会把列表挤出首屏。
  // 用媒体查询决定，而不是无条件选中。
  const isWide = useMediaQuery("(min-width: 1280px)");
  const effectiveOpenId = openId ?? (isWide ? (items[0]?.id ?? null) : null);

  const selected = items.find((it) => it.id === effectiveOpenId) ?? null;

  // 换题时答案面板回到顶部，否则长答案会停在上一条的滚动位置
  useEffect(() => {
    answerRef.current?.scrollTo({ top: 0 });
  }, [effectiveOpenId]);

  function navigate(next: { q?: string; c?: string; f?: boolean; p?: number }) {
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

  // 分类导航在 xl 以上常驻左栏；lg 时让出宽度给答案面板，折叠到列表上方
  const categoryNav = (
    <nav className="border-t border-neutral-100">
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
  );

  // 分类侧栏
  const categoryPanel = (
    <div className="xl:sticky xl:top-4">
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <div className="flex items-center justify-between px-3 py-2.5 text-sm font-medium">
          <span>
            分类
            <span className="ml-1.5 text-xs font-normal text-neutral-500">
              {favoritesOnly ? "收藏" : activeCategory} · {filteredCount} 道
            </span>
          </span>
        </div>
        {categoryNav}
      </div>
      {pending && <p className="mt-2 px-1 text-xs text-neutral-400">加载中…</p>}
    </div>
  );

  // 题目列表
  const listPanel = (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate({ q: draft, p: 0 });
          }}
          placeholder="搜索题目、标签或答案"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm sm:w-64"
        />
        <button
          onClick={() => navigate({ q: draft, p: 0 })}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
        >
          搜索
        </button>
        {(keyword || category || favoritesOnly) && (
          <button
            onClick={() => navigate({ q: "", c: "", f: false, p: 0 })}
            className="-my-2 inline-flex min-h-9 items-center px-1 text-xs text-neutral-500 underline hover:text-neutral-800"
          >
            清除筛选
          </button>
        )}
        <span className="ml-auto text-xs text-neutral-500">{filteredCount} 道</span>
      </div>

      <div className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {items.map((it) => {
          const active = effectiveOpenId === it.id;
          const fav = favOverride[it.id] ?? it.favorite;
          return (
            <div key={it.id}>
              <div
                className={`flex items-start gap-1 border-l-[3px] px-2.5 py-2.5 transition-colors ${
                  active
                    ? "border-emerald-600 bg-emerald-50/70"
                    : "border-transparent hover:bg-neutral-50"
                }`}
              >
                <button
                  onClick={() => toggleFavorite(it)}
                  disabled={favPending.has(it.id)}
                  aria-label={fav ? "取消收藏" : "收藏"}
                  aria-pressed={fav}
                  className={`-ml-1.5 -mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded text-sm leading-none transition-colors ${
                    fav
                      ? "text-amber-500 hover:bg-amber-50"
                      : "text-neutral-300 hover:bg-neutral-100 hover:text-amber-400"
                  } disabled:opacity-50`}
                >
                  {fav ? "★" : "☆"}
                </button>

                <button
                  onClick={() => setOpenId(active ? null : it.id)}
                  aria-current={active ? "true" : undefined}
                  className="min-w-0 flex-1 text-left"
                >
                  <p
                    className={`text-[13px] leading-relaxed ${
                      active ? "font-medium text-emerald-900" : "text-neutral-800"
                    }`}
                  >
                    {it.question}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-neutral-400">
                    <span>{it.category}</span>
                    <span>·</span>
                    <span>难度 {it.difficulty}</span>
                    {it.duplicates > 0 && (
                      <>
                        <span>·</span>
                        <span className="text-amber-600">
                          {it.duplicates + 1} 份收录
                        </span>
                      </>
                    )}
                  </div>
                </button>
              </div>

              {/* 窄屏：答案就地展开。宽屏由右栏承担 */}
              {active && (
                <div className="border-t border-emerald-100 bg-neutral-50/80 px-3 py-3 xl:hidden">
                  <AnswerBody text={it.answer} regenVersion={it.regenVersion} />
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
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => navigate({ p: Math.max(0, page - 1) })}
            disabled={page === 0 || pending}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs disabled:opacity-40"
          >
            上一页
          </button>
          <span className="text-xs text-neutral-600">
            {page + 1} / {pageCount}
          </span>
          <button
            onClick={() => navigate({ p: Math.min(pageCount - 1, page + 1) })}
            disabled={page >= pageCount - 1 || pending}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );

  // 答案面板
  const answerPanel = (
    <div className="min-w-0 xl:sticky xl:top-4">
      <div
        ref={answerRef}
        className="overflow-hidden rounded-lg border border-neutral-200 bg-white xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto"
      >
        {selected ? (
          <>
            <div className="border-b border-neutral-200 px-4 py-3">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-[13.5px] font-semibold leading-relaxed text-neutral-900">
                  {selected.question}
                </p>
                <button
                  onClick={() => toggleFavorite(selected)}
                  disabled={favPending.has(selected.id)}
                  aria-label={
                    (favOverride[selected.id] ?? selected.favorite)
                      ? "取消收藏"
                      : "收藏"
                  }
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded text-sm leading-none ${
                    (favOverride[selected.id] ?? selected.favorite)
                      ? "text-amber-500 hover:bg-amber-50"
                      : "text-neutral-300 hover:bg-neutral-100 hover:text-amber-400"
                  } disabled:opacity-50`}
                >
                  {(favOverride[selected.id] ?? selected.favorite) ? "★" : "☆"}
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-400">
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600">
                  {selected.category}
                </span>
                <span>难度 {selected.difficulty}</span>
                {selected.duplicates > 0 && (
                  <span className="text-amber-600">
                    {selected.duplicates + 1} 份题集收录
                  </span>
                )}
                {selected.tags.slice(0, 5).map((t) => (
                  <span key={t}>#{t}</span>
                ))}
              </div>
            </div>
            <div className="px-4 py-3.5">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                答案
              </div>
              <AnswerBody text={selected.answer} regenVersion={selected.regenVersion} />
            </div>
          </>
        ) : (
          <div className="px-4 py-16 text-center text-sm text-neutral-400">
            点击左侧题目查看答案
          </div>
        )}
      </div>
    </div>
  );

  // 窄屏：分类折叠条 + 内容顺序堆叠
  if (!isWide) {
    return (
      <div className="space-y-3">
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <button
            type="button"
            onClick={() => setCatOpen((v) => !v)}
            aria-expanded={catOpen}
            className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium hover:bg-neutral-50"
          >
            <span>
              分类
              <span className="ml-1.5 text-xs font-normal text-neutral-500">
                {favoritesOnly ? "收藏" : activeCategory} · {filteredCount} 道
              </span>
            </span>
            <span className="text-xs text-neutral-400">
              {catOpen ? "收起" : "展开"}
            </span>
          </button>
          {catOpen && categoryNav}
        </div>
        {listPanel}
      </div>
    );
  }

  return (
    <SplitView
      storageKey="pool-split"
      className="items-start"
      panes={[
        { key: "cat", initial: 15, min: 9, content: categoryPanel },
        { key: "list", initial: 35, min: 18, content: listPanel },
        { key: "answer", initial: 50, min: 22, content: answerPanel },
      ]}
    />
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
      className={`flex w-full items-center justify-between border-l-[3px] px-3 py-1.5 text-left text-[13px] transition-colors ${
        active
          ? `${activeCls} font-medium`
          : "border-transparent text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
      }`}
    >
      <span className="truncate">{label}</span>
      <span
        className={`ml-2 shrink-0 text-[11px] tabular-nums ${
          active ? "opacity-70" : "text-neutral-400"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
