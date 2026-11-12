"use client";

import { useMemo, useState } from "react";
import {
  hasSections,
  parseAnswerBlocks,
  parseAnswerSections,
  type AnswerSection,
} from "@/lib/pool/format";

/** 超过这个长度才折叠，避免短答案也藏起来 */
const COLLAPSE_CHARS = 1200;

/**
 * 答案渲染。
 *
 * 新答案（模型重生成）有固定结构：一句结论 + 若干编号要点。
 * 这里把结论做成独立强调块、要点做成带标题的小节，
 * 让读者先抓到一句话结论，再按需看细节。
 *
 * 旧答案没有结构，退回按内容识别段落/列表/代码渲染。
 */
export function AnswerBody({ text }: { text: string }) {
  const structured = useMemo(() => hasSections(text), [text]);
  return structured ? <StructuredAnswer text={text} /> : <PlainAnswer text={text} />;
}

// ---------- 新格式 ----------

function StructuredAnswer({ text }: { text: string }) {
  const sections = useMemo(() => parseAnswerSections(text), [text]);
  const long = text.length > COLLAPSE_CHARS;
  const [expanded, setExpanded] = useState(!long);

  const lead = sections.find((s) => s.type === "lead");
  const rest = sections.filter((s) => s.type !== "lead");
  // 折叠时给结论 + 两个要点：太少看不出全貌，太多又失去折叠意义
  const shown = expanded ? rest : rest.slice(0, 2);

  // 高亮计划按全文顺序算一次，且只覆盖真正会渲染的部分，
  // 这样「每个术语只标首次」在展开/收起时都成立。
  const plan = useMemo(() => {
    const builder = new EmphasisBuilder();
    const leadSet = lead ? builder.take(lead.body) : undefined;
    const sectionSets = shown.map((s) => ({
      title: s.title ? builder.take(s.title) : undefined,
      body: s.body ? builder.take(s.body) : undefined,
      items: s.items.map((it) => builder.take(it.text)),
    }));
    return { leadSet, sectionSets };
  }, [lead, shown]);

  return (
    <div className="text-[13.5px] leading-[1.85] text-neutral-700">
      {lead && (
        <p className="mb-4 rounded-md border-l-[3px] border-emerald-600 bg-emerald-50/60 px-3.5 py-2.5 text-[13.5px] leading-[1.8] text-neutral-800">
          <Inline text={lead.body} emphasis={plan.leadSet} />
        </p>
      )}

      <div className="space-y-3.5">
        {shown.map((s, i) => (
          <Section key={i} section={s} index={i + 1} emph={plan.sectionSets[i]} />
        ))}
      </div>

      {long && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 -mx-2 inline-flex min-h-9 items-center rounded px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 hover:underline"
        >
          {expanded
            ? "收起"
            : `展开其余 ${rest.length - shown.length} 个要点（全文 ${text.length} 字）`}
        </button>
      )}
    </div>
  );
}

function Section({
  section,
  index,
  emph,
}: {
  section: AnswerSection;
  index: number;
  emph: { title: Set<string> | undefined; body: Set<string> | undefined; items: Set<string>[] };
}) {
  if (section.type === "code") {
    return (
      <pre className="overflow-x-auto rounded-md border border-neutral-200 bg-neutral-900/[0.04] px-3.5 py-2.5 font-mono text-[12.5px] leading-[1.7] text-neutral-800">
        {section.body}
      </pre>
    );
  }

  return (
    <section>
      {section.title && (
        <h4 className="flex items-baseline gap-2 text-[13.5px] leading-snug">
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-emerald-700">
            {String(index).padStart(2, "0")}
          </span>
          <span className="font-semibold text-neutral-900">
            <Inline text={section.title} emphasis={emph.title} />
          </span>
        </h4>
      )}

      {section.body && (
        <p className={`whitespace-pre-wrap break-words ${section.title ? "mt-1.5 pl-6" : ""}`}>
          <Inline text={section.body} emphasis={emph.body} />
        </p>
      )}

      {section.items.length > 0 && (
        <ul className={`${section.title ? "mt-1.5 pl-6" : ""} space-y-1.5`}>
          {section.items.map((it, i) => (
            <li key={i} className="relative pl-3">
              <span className="absolute left-0 top-[0.7em] h-1 w-1 rounded-full bg-neutral-300" />
              {it.label && (
                <span className="font-medium text-neutral-900">
                  <Inline text={it.label} emphasis={emph.items[i]} />
                </span>
              )}
              {it.label && <span className="text-neutral-400"> · </span>}
              <Inline text={it.text} emphasis={emph.items[i]} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- 旧格式 ----------

function PlainAnswer({ text }: { text: string }) {
  const blocks = useMemo(() => parseAnswerBlocks(text), [text]);
  const long = text.length > COLLAPSE_CHARS;
  const [expanded, setExpanded] = useState(!long);
  const shown = expanded ? blocks : blocks.slice(0, 4);

  // 与 StructuredAnswer 同理：按块顺序分配，同一术语只标首次
  const plan = useMemo(() => {
    const builder = new EmphasisBuilder();
    return shown.map((b) => {
      if (b.type === "heading" || b.type === "paragraph") return builder.take(b.text);
      if (b.type === "list") return builder.take(b.items.join(" "));
      return undefined;
    });
  }, [shown]);

  return (
    <div className="text-[13.5px] leading-[1.85] text-neutral-700">
      <div className="max-w-[68ch] space-y-2.5">
        {shown.map((b, i) => {
          if (b.type === "heading") {
            return (
              <h4 key={i} className="mt-1 text-sm font-semibold text-neutral-900">
                <Inline text={b.text} emphasis={plan[i]} />
              </h4>
            );
          }
          if (b.type === "code") {
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-md border border-neutral-200 bg-neutral-900/[0.04] px-3.5 py-2.5 font-mono text-[12.5px] leading-[1.7] text-neutral-800"
              >
                <code>{b.text}</code>
              </pre>
            );
          }
          if (b.type === "list") {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag
                key={i}
                className={`ml-5 space-y-1 ${b.ordered ? "list-decimal" : "list-disc"} marker:text-neutral-300`}
              >
                {b.items.map((it, j) => (
                  <li key={j} className="pl-1">
                    <Inline text={it} emphasis={plan[i]} />
                  </li>
                ))}
              </Tag>
            );
          }
          return (
            <p key={i} className="whitespace-pre-wrap break-words">
              <Inline text={b.text} emphasis={plan[i]} />
            </p>
          );
        })}
      </div>

      {long && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 -mx-2 inline-flex min-h-9 items-center rounded px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 hover:underline"
        >
          {expanded ? "收起" : `展开全文（共 ${text.length} 字）`}
        </button>
      )}
    </div>
  );
}

// ---------- 行内高亮 ----------
//
// 重生成的答案里没有 Markdown 记号，模型直接输出裸文本，
// 所以只能按词形识别「这是一个技术名词」：
//   1. `反引号`            → 等宽 + 浅底（作者显式标注）
//   2. 「中文引号」         → 加粗，多用于「常见追问」
//   3. 驼峰 / 点号标识符    → 深色加粗：ThreadLocalMap、LockSupport.park
//   4. 已知英文缩写         → 同上：AQS、CAS、JMM
//
// 强调只靠字重，不改颜色。技术答案里术语密度本来就高，
// 一长段里二十来个词染成绿色会让整页泛绿，反而丢掉重点。

// 注意：带 g 标志的正则不能复用在 matchAll 之外，
// 模块级常量会被多次调用共享 lastIndex，导致漏匹配。每次调用新建一份。
const TOKEN_SRC =
  /`([^`]+)`|「([^」]+)」|([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*(?:[（(][A-Za-z][A-Za-z0-9 ()_.\-]{2,40}[）)])?)/.source;

/** 常见技术缩写，命中才上色，避免把普通英文单词也涂上 */
const TERMS = new Set([
  "AQS", "CAS", "JMM", "JVM", "GC", "CLH", "FIFO", "LIFO", "AOF", "RDB",
  "WAL", "MVCC", "TTL", "LRU", "LFU", "RPC", "SPI", "JIT", "TLAB", "OOM",
  "NIO", "AIO", "BIO", "CPU", "IO", "JDK", "JRE", "API", "DTO", "VO",
  "POJO", "ORM", "SQL", "ACID", "BASE", "CAP", "TPS", "QPS",
]);

/** 判断一个词是不是技术名词：缩写、驼峰、带点号的方法链 */
function isTerm(word: string): boolean {
  const base = word.split(/[（(.]/)[0];
  if (TERMS.has(base.toUpperCase()) && base === base.toUpperCase()) return true;
  if (TERMS.has(base.split(/(?=[A-Z])/)[0])) return true;
  // ThreadLocalMap / tryAcquireShared / InterruptedException
  if (/[a-z][A-Z]/.test(word)) return true;
  // LockSupport.park / Thread.currentThread
  if (word.includes(".")) return true;
  return false;
}

/**
 * 按渲染顺序分配「该高亮哪些词」。
 * 同一个术语只标首次出现——答案里 ThreadLocal 常重复十几次，
 * 每次都上色会让三成字符变绿，反而没有重点。
 */
class EmphasisBuilder {
  private seen = new Set<string>();

  take(piece: string): Set<string> {
    const mine = new Set<string>();
    for (const m of piece.matchAll(new RegExp(TOKEN_SRC, "g"))) {
      const word = m[3];
      if (word === undefined) continue;
      if (isTerm(word) && !this.seen.has(word)) {
        this.seen.add(word);
        mine.add(word);
      }
    }
    return mine;
  }
}

function Inline({ text, emphasis }: { text: string; emphasis?: Set<string> }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  // emphasis 只说明「这个词要在某处被标出」，块内还有多次重复出现时
  // 只标第一次，否则一段话里同一个名字会亮好几遍。
  const done = new Set<string>();

  const push = (node: React.ReactNode) => parts.push(<span key={key++}>{node}</span>);

  for (const m of text.matchAll(new RegExp(TOKEN_SRC, "g"))) {
    const idx = m.index ?? 0;
    if (idx > last) push(text.slice(last, idx));
    last = idx + m[0].length;

    if (m[1] !== undefined) {
      // 反引号
      push(
        <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[0.88em] text-neutral-800">
          {m[1]}
        </code>,
      );
    } else if (m[2] !== undefined) {
      // 中文引号 → 强调
      push(<strong className="font-semibold text-neutral-900">{m[2]}</strong>);
    } else {
      const word = m[3];
      if (emphasis?.has(word) && !done.has(word)) {
        done.add(word);
        push(<span className="font-semibold text-neutral-900">{word}</span>);
      } else {
        push(word);
      }
    }
  }
  if (last < text.length) push(text.slice(last));

  return <>{parts}</>;
}
