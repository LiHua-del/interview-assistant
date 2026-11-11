"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CollapsibleCard } from "@/components/ui";
import { ReviewReportView } from "@/components/ReviewReportView";
import type { ReviewResult } from "@/lib/llm/schemas";

export function ReviewPanel({
  candidateId,
  jobs,
  hasQuestionSet,
}: {
  candidateId: string;
  jobs: { id: string; title: string }[];
  hasQuestionSet: boolean;
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [transcript, setTranscript] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rev, setRev] = useState<ReviewResult | null>(null);

  async function run() {
    setBusy(true);
    setError("");
    setRev(null);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, jobId, transcript, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "复盘失败");
      setRev(data.review);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "复盘失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <CollapsibleCard title="面试复盘" hint="模块二">

      {!hasQuestionSet && (
        <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          该候选人还没有题单，复盘将无法计算覆盖率与命中率。建议先在上方出题。
        </p>
      )}

      <div className="grid gap-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">岗位</span>
          <select
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          >
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            面试纪要<span className="ml-0.5 text-red-500">*</span>
          </span>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={10}
            placeholder={"粘贴文字版纪要，建议用「面试官：」「候选人：」开头，便于定位问答对。\n\n示例：\n面试官：说说你在字节做的优惠券项目。\n候选人：我负责优惠券发放接口……"}
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm font-mono"
          />
          <span className="mt-1 block text-xs text-neutral-500">
            {transcript.length} 字符
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">面试官总结（选填）</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="主观印象、待确认事项等"
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="flex justify-end">
          <button
            onClick={run}
            disabled={busy || !transcript.trim() || !jobId}
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? "复盘分析中…" : "开始复盘"}
          </button>
        </div>
      </div>

      {busy && (
        <p className="mt-3 rounded bg-blue-50 px-3 py-2 text-sm text-blue-700">
          正在分析候选人表现与面试官提问质量，约需 1 分钟。
        </p>
      )}

      {error && (
        <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {rev && (
        <div className="mt-6 border-t border-neutral-200 pt-5">
          <ReviewReportView
            metrics={rev.metrics}
            verdict={rev.verdict}
            verdictReason={rev.verdictReason}
            strengths={rev.strengths}
            weaknesses={rev.weaknesses}
            attribution={rev.attribution}
            interviewerAnalysis={rev.interviewerAnalysis}
            digDeeper={rev.digDeeper}
            unverifiedQuotes={rev.unverifiedQuotes}
          />
        </div>
      )}
    </CollapsibleCard>
  );
}

function verdictTone(v: string) {
  if (v.includes("强烈")) return "green" as const;
  if (v.includes("不推荐")) return "red" as const;
  if (v.includes("待定")) return "amber" as const;
  return "blue" as const;
}

function causeTone(c: string) {
  if (c === "真不会") return "red" as const;
  if (c === "没问到") return "amber" as const;
  if (c === "问偏了") return "purple" as const;
  return "neutral" as const;
}
