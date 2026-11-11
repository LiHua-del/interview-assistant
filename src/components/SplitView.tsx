"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * 可拖拽分栏。
 *
 * 用 flex + 百分比宽度，不用 grid：拖动时只改相邻两栏的基准宽度，
 * 其余栏不受影响，总宽恒定。按百分比存，窗口缩放时比例不变。
 *
 * 分隔条是独立元素而非 border：给它 11px 热区、1px 视觉线，
 * 好抓又不占栏宽（负 margin 抵消，见 SplitHandle）。
 */

export type SplitPane = {
  /** 稳定标识，用于持久化各栏宽度 */
  key: string;
  content: ReactNode;
  /** 初始宽度百分比，合计应为 100 */
  initial: number;
  /** 最小宽度百分比，拖不过去 */
  min?: number;
  /** 窄屏堆叠时是否隐藏该栏（内容已在别处呈现时用） */
  hideWhenStacked?: boolean;
};

const MIN_DEFAULT = 12;

function loadWidths(storageKey: string, panes: SplitPane[]): number[] {
  const fallback = panes.map((p) => p.initial);
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, number>;
    const widths = panes.map((p, i) => {
      const v = parsed[p.key];
      return typeof v === "number" && Number.isFinite(v) ? v : fallback[i];
    });
    // 存的值来自不同的栏数时合计对不上，直接丢弃
    const sum = widths.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > 0.5) return fallback;
    return widths;
  } catch {
    return fallback;
  }
}

const BP = { md: 768, lg: 1024, xl: 1280 } as const;

export function SplitView({
  panes,
  storageKey,
  stackBelow,
  className = "",
}: {
  panes: SplitPane[];
  storageKey: string;
  /** 低于该断点时竖向堆叠，忽略拖动宽度 */
  stackBelow?: keyof typeof BP;
  className?: string;
}) {
  // 首帧用初始比例；挂载后再读本地存储，避免服务端与客户端首帧不一致
  const [widths, setWidths] = useState<number[]>(() => panes.map((p) => p.initial));
  const [ready, setReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    index: number;
    startX: number;
    startWidths: number[];
    containerWidth: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  // 窄屏竖向堆叠：inline 的 flexBasis 无法被媒体查询覆盖，只能用 JS 判断
  const wide = useMediaQuery(stackBelow ? `(min-width: ${BP[stackBelow]}px)` : "");
  // 只有进入宽屏且尚未读存储时才需要隐藏首帧
  const show = ready || !!stackBelow;

  // 本地存储只在挂载后读一次
  useEffect(() => {
    const saved = loadWidths(storageKey, panes);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 读取外部存储，无外部可订阅源
    setWidths(saved);
     
    setReady(true);
    // 只在 storageKey 变化时重读
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const persist = useCallback(
    (next: number[]) => {
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify(Object.fromEntries(panes.map((p, i) => [p.key, next[i]]))),
        );
      } catch {
        // 隐私模式下不可写，忽略
      }
    },
    [panes, storageKey],
  );

  const onMove = useCallback(
    (clientX: number) => {
      const d = dragRef.current;
      if (!d) return;
      const deltaPct = ((clientX - d.startX) / d.containerWidth) * 100;
      const a = d.index;
      const b = d.index + 1;
      const minA = panes[a].min ?? MIN_DEFAULT;
      const minB = panes[b].min ?? MIN_DEFAULT;

      let wa = d.startWidths[a] + deltaPct;
      let wb = d.startWidths[b] - deltaPct;
      if (wa < minA) {
        wb -= minA - wa;
        wa = minA;
      }
      if (wb < minB) {
        wa -= minB - wb;
        wb = minB;
      }
      setWidths((cur) => {
        const next = [...cur];
        next[a] = wa;
        next[b] = wb;
        return next;
      });
    },
    [panes],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      e.preventDefault();
      onMove(e.clientX);
    };
    const up = () => {
      setDragging(false);
      dragRef.current = null;
      // 拖动结束后落盘；过程中不写，避免频繁 IO
      setWidths((cur) => {
        persist(cur);
        return cur;
      });
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, onMove, persist]);

  // 拖动中锁光标与选区，避免拖到文字上被选中
  useEffect(() => {
    if (!dragging) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging]);

  function startDrag(index: number, e: React.PointerEvent) {
    const el = containerRef.current;
    if (!el) return;
    e.preventDefault();
    dragRef.current = {
      index,
      startX: e.clientX,
      startWidths: widths,
      containerWidth: el.getBoundingClientRect().width,
    };
    setDragging(true);
  }

  /** 键盘调整：方向键每次 2%，无鼠标也能用 */
  function nudge(index: number, dir: -1 | 1) {
    const a = index;
    const b = index + 1;
    const minA = panes[a].min ?? MIN_DEFAULT;
    const minB = panes[b].min ?? MIN_DEFAULT;
    const wa = widths[a] + dir * 2;
    const wb = widths[b] - dir * 2;
    if (wa < minA || wb < minB) return;
    const next = [...widths];
    next[a] = wa;
    next[b] = wb;
    setWidths(next);
    persist(next);
  }

  /** 双击分隔条恢复默认比例 */
  function reset() {
    const next = panes.map((p) => p.initial);
    setWidths(next);
    persist(next);
  }

  return (
    <div
      ref={containerRef}
      className={`flex ${wide ? "" : "flex-col"} ${className}`}
    >
      {panes.map((pane, i) => {
        if (!wide && pane.hideWhenStacked) return null;
        // 不能包 wrapper：多余的一层会参与 flex 布局，把宽度算乱
        return (
          <Fragment key={pane.key}>
            <div
              className="min-w-0"
              style={
                wide
                  ? {
                      flexBasis: `${widths[i]}%`,
                      flexGrow: 0,
                      flexShrink: 0,
                      // 首帧用默认比例，读到存储前先隐藏，避免宽度跳变
                      visibility: show ? undefined : "hidden",
                    }
                  : undefined
              }
            >
              {pane.content}
            </div>

            {wide && i < panes.length - 1 && (
              <SplitHandle
                index={i}
                value={widths[i]}
                dragging={dragging}
                onStart={startDrag}
                onNudge={nudge}
                onReset={reset}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/** 订阅媒体查询；服务端返回 false，避免水合不一致 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    useCallback(
      (cb: () => void) => {
        if (!query) return () => {};
        const mq = window.matchMedia(query);
        mq.addEventListener("change", cb);
        return () => mq.removeEventListener("change", cb);
      },
      [query],
    ),
    () => (query ? window.matchMedia(query).matches : true),
    () => false,
  );
}

function SplitHandle({
  index,
  value,
  dragging,
  onStart,
  onNudge,
  onReset,
}: {
  index: number;
  value: number;
  dragging: boolean;
  onStart: (index: number, e: React.PointerEvent) => void;
  onNudge: (index: number, dir: -1 | 1) => void;
  onReset: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整栏宽"
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={(e) => onStart(index, e)}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onNudge(index, -1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onNudge(index, 1);
        }
      }}
      // 11px 热区，视觉只有中间 1px 线
      className="group relative z-10 flex w-[11px] shrink-0 cursor-col-resize touch-none select-none items-center justify-center self-stretch focus:outline-none"
    >
      {/* 常态就可见，否则用户不知道这里能拖 */}
      <div
        className={`h-full w-px transition-colors ${
          dragging
            ? "bg-emerald-500"
            : "bg-neutral-200 group-hover:bg-emerald-400 group-focus-visible:bg-emerald-500"
        }`}
      />
      {/* 悬停时两侧各延伸一条淡色带，扩大视觉提示 */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 -left-0.5 block w-2 rounded-full transition-opacity ${
          dragging ? "bg-emerald-100 opacity-100" : "bg-emerald-50 opacity-0 group-hover:opacity-100"
        }`}
      />
      {/* grabber：平时不显示，悬停/聚焦/拖动时露出，提示可拖 */}
      <span
        aria-hidden
        className={`absolute top-1/2 block h-8 w-[5px] -translate-y-1/2 rounded-full transition-all ${
          dragging
            ? "bg-emerald-500 opacity-100"
            : "bg-neutral-300 opacity-60 group-hover:bg-emerald-500 group-hover:opacity-100 group-focus-visible:bg-emerald-500 group-focus-visible:opacity-100"
        }`}
      />
    </div>
  );
}
