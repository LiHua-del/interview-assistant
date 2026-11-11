"use client";

import { useState } from "react";
import { Badge } from "@/components/ui";
import type { InterviewQuestion } from "@/lib/db/schema";

const PRIORITY_TONE = {
  必问: "red",
  选问: "blue",
  备用: "neutral",
} as const;

const CAT_TONE = {
  实习经历: "purple",
  项目经历: "blue",
  技术基础: "neutral",
  软素质: "amber",
} as const;

export function QuestionList({ questions, expectedLevels }: { questions: InterviewQuestion[]; expectedLevels?: number }) {
  const [filter, setFilter] = useState<"全部" | "必问" | "选问" | "备用">("全部");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const shown =
    filter === "全部" ? questions : questions.filter((q) => q.priority === filter);

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  const counts = {
    必问: questions.filter((q) => q.priority === "必问").length,
    选问: questions.filter((q) => q.priority === "选问").length,
    备用: questions.filter((q) => q.priority === "备用").length,
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {(["全部", "必问", "选问", "备用"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded border px-3 py-1 text-xs ${
              filter === f
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            {f}
            {f !== "全部" && ` ${counts[f as keyof typeof counts]}`}
          </button>
        ))}
        <button
          onClick={() => setExpanded(new Set(questions.map((q) => q.id)))}
          className="ml-auto rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50"
        >
          全部展开
        </button>
        <button
          onClick={() => setExpanded(new Set())}
          className="rounded border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-50"
        >
          全部收起
        </button>
      </div>

      <div className="space-y-2">
        {shown.map((q, i) => {
          const open = expanded.has(q.id);
          const incomplete = expectedLevels !== undefined && q.followups.length < expectedLevels;
          return (
            <div
              key={q.id}
              className="rounded border border-neutral-200 bg-white"
            >
              <button
                onClick={() => toggle(q.id)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-neutral-50"
              >
                <span className="mt-0.5 shrink-0 text-xs font-mono text-neutral-400">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={PRIORITY_TONE[q.priority]}>{q.priority}</Badge>
                    <Badge tone={CAT_TONE[q.category]}>{q.category}</Badge>
                    {q.tech && <Badge tone="purple">{q.tech}</Badge>}
                    {q.personalized && <Badge tone="amber">个性化</Badge>}
                    {incomplete && <Badge tone="amber">追问不完整</Badge>}
                  </div>
                  {q.scene && (
                    <p className="mt-1 text-xs text-neutral-500">
                      场景：{q.scene}
                      {q.depth && (
                        <span className="ml-2 text-neutral-400">
                          简历描述：{q.depth}
                        </span>
                      )}
                    </p>
                  )}
                  <p className="mt-1.5 text-sm leading-relaxed">{q.question}</p>
                  <p className="mt-1 text-xs text-neutral-400">
                    难度 {q.difficulty}/5
                    {q.dimension && <> · 考察{q.dimension}</>}
                    {q.followups.length > 0 && (
                      <> · {q.followups.length} 层追问</>
                    )}
                  </p>
                </div>
                <span className="mt-1 shrink-0 text-neutral-400">
                  {open ? "−" : "+"}
                </span>
              </button>

              {open && (
                <QuestionDetails question={q} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const LEVEL_LABEL: Record<number, string> = {
  1: "落地细节：具体做了什么",
  2: "选型权衡：为什么这么做",
  3: "边界故障：什么情况会出问题",
  4: "演进迁移：重做会怎么改",
  5: "极限推演：规模放大十倍",
};

function triggerLabel(level: number) {
  return LEVEL_LABEL[level] ?? `第 ${level} 层追问`;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-xs font-medium text-neutral-500">{children}</div>
  );
}

function PointList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: string;
}) {
  return (
    <div>
      <Label>{title}</Label>
      <ul className="space-y-1">
        {items.map((x, i) => (
          <li key={i} className={`text-xs ${tone}`}>
            · {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function QuestionDetails({ question: q }: { question: InterviewQuestion }) {
  return (
                <div className="border-t border-neutral-100 px-4 py-3 space-y-4">
                  {q.resumeAnchor && (
                    <div>
                      <Label>简历锚点</Label>
                      <p className="rounded bg-neutral-50 p-2 text-xs italic text-neutral-600">
                        {q.resumeAnchor}
                      </p>
                    </div>
                  )}

                  <div>
                    <Label>追问路径 · {q.followups.length} 层</Label>
                    <div className="space-y-2">
                      {q.followups.length === 0 && (
                        <p className="text-xs text-amber-600">
                          该题尚未生成追问，可返回出题页重新生成题单。
                        </p>
                      )}
                      {q.followups.map((f) => (
                        <div
                          key={f.level}
                          className="rounded border border-neutral-200 p-2.5"
                        >
                          <div className="flex items-center gap-1.5">
                            <Badge tone="blue">L{f.level}</Badge>
                            <span className="text-xs text-neutral-500">
                              {triggerLabel(f.level)}
                            </span>
                          </div>
                          {f.trigger && (
                            <p className="mt-1 text-xs text-neutral-400">
                              触发：{f.trigger}
                            </p>
                          )}
                          <p className="mt-1 text-sm">{f.question}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <details>
                    <summary className="cursor-pointer text-sm text-emerald-800">评分要点与判断信号</summary>
                    <div className="mt-3 grid gap-3">
                    {q.expectedPoints.length > 0 && (
                      <PointList
                        title="评分要点"
                        items={q.expectedPoints}
                        tone="text-neutral-700"
                      />
                    )}
                    {q.goodSignals.length > 0 && (
                      <PointList
                        title="优秀信号"
                        items={q.goodSignals}
                        tone="text-emerald-700"
                      />
                    )}
                    {q.redFlags.length > 0 && (
                      <PointList
                        title="红旗信号"
                        items={q.redFlags}
                        tone="text-red-700"
                      />
                    )}
                    </div>
                  </details>
                </div>
  );
}
