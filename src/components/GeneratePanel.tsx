"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CollapsibleCard, Badge } from "@/components/ui";
import { QuestionList } from "@/components/QuestionList";
import { DeleteButton } from "@/components/DeleteButton";
import type { InterviewQuestion, JobQuestionConfig } from "@/lib/db/schema";

type Job = { id: string; title: string; config: JobQuestionConfig };

export type SavedSet = {
  id: string;
  jobId: string;
  createdAt: number;
  count: number;
  followupLevels?: number;
  questions: InterviewQuestion[];
  reusablePrompt: string;
  sources: { llm: boolean; pool: boolean; techPoints?: number; web?: boolean } | null;
  distribution: Record<string, number>;
};

export function GeneratePanel({
  candidateId,
  jobs,
  existingSets,
}: {
  candidateId: string;
  jobs: Job[];
  existingSets: SavedSet[];
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [count, setCount] = useState(5);
  const [bias, setBias] = useState<"risk" | "highlight" | "balanced">("balanced");
  const [levels, setLevels] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [generatedSet, setGeneratedSet] = useState<SavedSet | null>(null);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const savedSets = (generatedSet && !existingSets.some((set) => set.id === generatedSet.id)
    ? [generatedSet, ...existingSets]
    : existingSets).filter((set) => !deletedIds.includes(set.id));
  // 默认展示最近一次保存的题单——刷新页面后仍能看到，不必重新生成
  const [result, setResult] = useState<{
    questions: InterviewQuestion[];
    reusablePrompt: string;
    warnings: string[];
    distribution: Record<string, number>;
    dropped: { question: string; reason: string }[];
    savedId?: string;
    savedAt?: number;
    followupLevels?: number;
  } | null>(() => {
    const latest = existingSets[0];
    if (!latest) return null;
    return {
      questions: latest.questions,
      reusablePrompt: latest.reusablePrompt,
      warnings: [],
      distribution: latest.distribution,
      dropped: [],
      savedId: latest.id,
      savedAt: latest.createdAt,
      followupLevels: latest.followupLevels,
    };
  });

  const job = jobs.find((j) => j.id === jobId);
  const totalExpected = job
    ? job.config.baseMustCount +
      job.config.baseOptionalCount +
      job.config.baseReserveCount +
      count
    : 0;
  // 每道题约 20 秒补全耗时（本机模型），用于给用户预期
  const etaMin = Math.round((totalExpected * 0.3) / 6);

  async function run() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          candidateId,
          personalizedCount: count,
          personalizedBias: bias,
          followupLevels: levels,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "出题失败");
      setResult({ ...data, followupLevels: levels });
      setGeneratedSet({
        id: data.savedId ?? data.id,
        jobId,
        createdAt: data.savedAt ?? Math.floor(Date.now() / 1000),
        count: data.questions.length,
        questions: data.questions,
        reusablePrompt: data.reusablePrompt,
        sources: data.sources,
        distribution: data.distribution,
        followupLevels: levels,
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "出题失败");
    } finally {
      setBusy(false);
    }
  }

  function showSet(set: SavedSet) {
    setNotice("");
    setResult({
      questions: set.questions,
      reusablePrompt: set.reusablePrompt,
      warnings: [],
      distribution: set.distribution,
      dropped: [],
      savedId: set.id,
      savedAt: set.createdAt,
      followupLevels: set.followupLevels,
    });
  }

  return (
    <CollapsibleCard title="出题与题单" hint={`${savedSets.length} 份已保存`} defaultOpen>

      <div className="mb-5 space-y-2" aria-label="已保存题单">
        <p className="text-xs text-neutral-500">每次生成都会新增一份题单。选中可预览；删除当前题单前请先取消选中，再确认永久删除。</p>
        {notice && <p role="status" className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}
        {savedSets.length === 0 && <p className="rounded border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">暂无题单，请在下方生成第一份。</p>}
        {savedSets.map((set) => {
          const active = result?.savedId === set.id;
          const label = `${jobs.find((job) => job.id === set.jobId)?.title ?? "未知岗位"} · ${new Date(set.createdAt * 1000).toLocaleString("zh-CN")} · ${set.count} 题`;
          return <div key={set.id} data-question-set-id={set.id} className={`flex flex-wrap items-center gap-3 rounded border p-3 ${active ? "border-emerald-600 bg-emerald-50/50" : "border-neutral-200"}`}>
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm">
              <input type="radio" name={`question-set-${candidateId}`} checked={active} disabled={busy} onChange={() => showSet(set)} aria-label={`选择题单：${label}`} className="accent-emerald-700" />
              <span>{label}<span className="ml-2 text-xs text-neutral-500">#{set.id.slice(0, 6)}{active ? " · 当前选中" : ""}</span></span>
            </label>
            <Link href={`/candidates/${candidateId}/interview?setId=${encodeURIComponent(set.id)}`} className="rounded border border-emerald-700 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-50">进入面试模式 →</Link>
            {active && <button type="button" disabled={busy} onClick={() => {
              setResult(null);
              setNotice("已取消选中，题单仍保留在列表中；可重新选中，或点击删除。");
            }} className="rounded border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">取消选中</button>}
            <DeleteButton
              endpoint={`/api/candidates/${candidateId}/question-sets/${encodeURIComponent(set.id)}`}
              name={`题单 #${set.id.slice(0, 6)}`}
              warning={`${label}。仅永久删除这份题单及其 Prompt，不删除候选人和简历。已有面试纪要与评估报告会保留，但与该题单的关联会解除。`}
              disabled={active || busy}
              onDeleted={() => {
                setDeletedIds((ids) => [...ids, set.id]);
                if (generatedSet?.id === set.id) setGeneratedSet(null);
                setNotice(`已永久删除题单 #${set.id.slice(0, 6)}。`);
              }}
            />
          </div>;
        })}
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-neutral-500">
          还没有岗位，先到「岗位」页新建一个。
        </p>
      ) : (
        <>
          <details open={savedSets.length === 0} className="mb-4 rounded border border-neutral-200">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">生成新题单 · 保留已有题单</summary>
            <div className="border-t border-neutral-200 p-4">
          <div className="grid gap-4 md:grid-cols-5">
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
              {job && (
                <span className="mt-1 block text-xs text-neutral-500">
                  岗位题单 {job.config.baseMustCount}必问+
                  {job.config.baseOptionalCount}选问+
                  {job.config.baseReserveCount}备用
                </span>
              )}
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">
                个性化增补题数
              </span>
              <input
                type="number"
                min={0}
                max={20}
                value={count}
                onChange={(e) => setCount(Number(e.target.value) || 0)}
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-neutral-500">
                0 = 纯岗位题单，便于横向对比
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">增补倾向</span>
              <select
                value={bias}
                onChange={(e) => setBias(e.target.value as typeof bias)}
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              >
                <option value="balanced">均衡</option>
                <option value="risk">验真优先</option>
                <option value="highlight">挖掘亮点</option>
              </select>
              <span className="mt-1 block text-xs text-neutral-500">
                {bias === "risk"
                  ? "全部来自风险可疑点"
                  : bias === "highlight"
                    ? "来自被一笔带过的高价值部分"
                    : "可疑点与亮点各半"}
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">追问层数</span>
              <select
                value={levels}
                onChange={(e) => setLevels(Number(e.target.value))}
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              >
                <option value={2}>2 层 · 快速筛</option>
                <option value={3}>3 层 · 标准</option>
                <option value={4}>4 层 · 深挖</option>
                <option value={5}>5 层 · 极限</option>
              </select>
              <span className="mt-1 block text-xs text-neutral-500">
                层数越深耗时越长
              </span>
            </label>

            <div className="flex items-end">
              <button
                onClick={run}
                disabled={busy || !jobId}
                className="w-full rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy ? "生成中…" : `新增题单（${totalExpected} 题）`}
              </button>
            </div>
          </div>

          </div>
          </details>

          {busy && (
            <p className="mt-3 rounded bg-blue-50 px-3 py-2 text-sm text-blue-700">
              正在生成题单。需要为每道题补 {levels} 层追问与评分信号，约需{" "}
              {Math.max(etaMin, 1)}–{Math.max(etaMin + 3, 3)} 分钟，请勿关闭页面。
            </p>
          )}

          {error && (
            <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {result && (
            <div className="mt-4 space-y-3">
              {result.savedAt && (
                <p className="text-xs text-neutral-500">
                  已保存的题单 · 生成于{" "}
                  {new Date(result.savedAt * 1000).toLocaleString("zh-CN")}
                  <span className="ml-2 text-neutral-400">
                    共 {result.questions.length} 题
                  </span>
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {Object.entries(result.distribution).map(([k, v]) => (
                  <Badge key={k}>
                    {k} {v}
                  </Badge>
                ))}
                {result.dropped.length > 0 && (
                  <Badge tone="amber">丢弃 {result.dropped.length} 题</Badge>
                )}
              </div>
              {result.warnings.map((w, i) => (
                <p
                  key={i}
                  className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800"
                >
                  {w}
                </p>
              ))}

              {result.savedId && <Link
                href={`/candidates/${candidateId}/interview?setId=${encodeURIComponent(result.savedId)}`}
                className="inline-flex rounded-md bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900"
              >使用这份题单进入面试模式 →</Link>}

              <details className="rounded border border-neutral-200">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">查看题目预览（{result.questions.length} 题）</summary>
                <div className="border-t border-neutral-200 p-4"><QuestionList questions={result.questions} expectedLevels={result.followupLevels} /></div>
              </details>

              <details className="rounded border border-neutral-200">
                <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium hover:bg-neutral-50">
                  可复用 Prompt（拿去其他 AI 生成更多题）
                </summary>
                <div className="border-t border-neutral-200 p-4">
                  <pre className="prose-block max-h-96 overflow-y-auto rounded bg-neutral-50 p-3 text-xs">
                    {result.reusablePrompt}
                  </pre>
                  <button
                    onClick={() =>
                      navigator.clipboard.writeText(result.reusablePrompt)
                    }
                    className="mt-2 rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
                  >
                    复制
                  </button>
                </div>
              </details>

              {result.dropped.length > 0 && (
                <details className="rounded border border-neutral-200">
                  <summary className="cursor-pointer px-4 py-2.5 text-xs text-neutral-500 hover:bg-neutral-50">
                    被丢弃的题目（{result.dropped.length}）
                  </summary>
                  <div className="border-t border-neutral-200 p-4 space-y-1">
                    {result.dropped.map((d, i) => (
                      <p key={i} className="text-xs text-neutral-500">
                        <span className="text-red-600">{d.reason}</span>
                        {" — "}
                        {d.question.slice(0, 50)}
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}


        </>
      )}
    </CollapsibleCard>
  );
}
