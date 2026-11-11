"use client";

import { useMemo, useState } from "react";
import { parseAnswerBlocks } from "@/lib/pool/format";

/** 超过这个长度默认折叠，避免长答案把列表撑爆 */
const COLLAPSE_CHARS = 800;
const COLLAPSE_LINES = 14;

/**
 * 答案渲染。
 *
 * 题库里的答案来自 PDF 抽取，原先是纯文本一坨。
 * 这里按内容识别结构后分别渲染：段落、小标题、列表、代码。
 */
export function AnswerBody({ text }: { text: string }) {
  const blocks = useMemo(() => parseAnswerBlocks(text), [text]);
  const long = text.length > COLLAPSE_CHARS;
  const [expanded, setExpanded] = useState(!long);

  const shown = expanded ? blocks : trimBlocks(blocks, COLLAPSE_LINES);
  const truncated = !expanded && shown.length < blocks.length;

  return (
    <div className="text-[13.5px] leading-[1.85] text-neutral-700">
      <div className={long && !expanded ? "relative" : ""}>
        <div className="max-w-[68ch] space-y-2.5">
          {shown.map((b, i) => (
            <Block key={i} block={b} />
          ))}
        </div>
        {long && !expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-neutral-50 to-transparent" />
        )}
      </div>

      {long && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-xs font-medium text-emerald-700 hover:underline"
        >
          {expanded
            ? "收起"
            : truncated
              ? `展开剩余（共 ${text.length} 字）`
              : "展开全文"}
        </button>
      )}
    </div>
  );
}

function Block({
  block,
}: {
  block: ReturnType<typeof parseAnswerBlocks>[number];
}) {
  switch (block.type) {
    case "heading":
      return (
        <h4 className="mt-1 text-sm font-semibold text-neutral-900">
          {block.text}
        </h4>
      );

    case "list":
      return block.ordered ? (
        <ol className="ml-5 list-decimal space-y-1 marker:text-neutral-400">
          {block.items.map((it, i) => (
            <li key={i} className="pl-1">
              {it}
            </li>
          ))}
        </ol>
      ) : (
        <ul className="ml-5 list-disc space-y-1 marker:text-neutral-300">
          {block.items.map((it, i) => (
            <li key={i} className="pl-1">
              {it}
            </li>
          ))}
        </ul>
      );

    case "code":
      return (
        <pre className="overflow-x-auto rounded-md border border-neutral-200 bg-neutral-900/[0.04] px-3.5 py-2.5 font-mono text-[12.5px] leading-[1.7] text-neutral-800">
          <code>{block.text}</code>
        </pre>
      );

    default:
      return (
        <p className="whitespace-pre-wrap break-words">{block.text}</p>
      );
  }
}

/** 折叠时按行数截断，保证不会切断代码块中间 */
function trimBlocks(
  blocks: ReturnType<typeof parseAnswerBlocks>,
  maxLines: number,
) {
  const out: typeof blocks = [];
  let lines = 0;
  for (const b of blocks) {
    const cost =
      b.type === "list" ? b.items.length : Math.max(1, b.text.split("\n").length);
    if (lines + cost > maxLines && out.length > 0) break;
    out.push(b);
    lines += cost;
  }
  return out;
}
