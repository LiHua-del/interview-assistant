import { Badge, Stat } from "@/components/ui";
import type { InterviewerAnalysis } from "@/lib/db/schema";

type Metrics = {
  coverage: { asked: number; total: number; ratio: number };
  hitRate: { hit: number; answered: number; ratio: number };
  dimensions: { key: string; name: string; score: number; weight: number }[];
  weightedTotal: number;
};

type Attribution = { topic: string; cause: string; evidence: string }[];

/**
 * 评估报告的渲染层。
 * 与数据来源解耦：既能渲染刚生成的（内存中的）复盘，也能渲染库里已存的轮次。
 */
export function ReviewReportView({
  metrics,
  verdict,
  verdictReason,
  strengths,
  weaknesses,
  attribution,
  interviewerAnalysis,
  digDeeper,
  unverifiedQuotes,
}: {
  metrics: Metrics;
  verdict: string;
  verdictReason?: string;
  strengths?: { point: string; evidence: string }[];
  weaknesses?: { point: string; evidence: string }[];
  attribution: Attribution;
  interviewerAnalysis: InterviewerAnalysis;
  digDeeper?: { topic: string; suggestion: string }[];
  unverifiedQuotes?: string[];
}) {
  const m = metrics;
  const ia = interviewerAnalysis;

  return (
    <div className="space-y-5">
      {verdictReason && (
        <div className="flex items-start gap-3">
          <Badge tone={verdictTone(verdict)}>{verdict}</Badge>
          <p className="text-sm text-neutral-700">{verdictReason}</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="题单覆盖率"
          value={`${Math.round(m.coverage.ratio * 100)}%`}
          hint={`${m.coverage.asked}/${m.coverage.total} 必问题被问到`}
          tone="blue"
        />
        <Stat
          label="答题命中率"
          value={`${Math.round(m.hitRate.ratio * 100)}%`}
          hint={`${m.hitRate.hit}/${m.hitRate.answered} 有效回答命中要点`}
          tone="purple"
        />
        <Stat
          label="加权总分"
          value={m.weightedTotal.toFixed(2)}
          hint="按 Rubric 权重加权，满分 5"
        />
        <Stat
          label="候选人发言占比"
          value={`${Math.round(ia.candidateTalkRatio * 100)}%`}
          hint="低于 50% 说明给的空间不足"
          tone={ia.candidateTalkRatio < 0.5 ? "amber" : "green"}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">维度得分</h3>
        <div className="space-y-1.5">
          {m.dimensions.map((d) => (
            <div key={d.key} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-xs text-neutral-600">
                {d.name}
              </span>
              <div className="h-2 flex-1 rounded bg-neutral-100">
                <div
                  className={`h-2 rounded ${
                    d.score >= 4
                      ? "bg-emerald-500"
                      : d.score >= 3
                        ? "bg-amber-500"
                        : "bg-red-500"
                  }`}
                  style={{ width: `${(d.score / 5) * 100}%` }}
                />
              </div>
              <span className="w-14 text-right text-xs text-neutral-500">
                {d.score}/5 · {d.weight}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {ia.complianceRedFlags.length > 0 && (
        <div className="rounded border-2 border-red-300 bg-red-50 p-4">
          <h3 className="text-sm font-semibold text-red-800">
            合规红线提问 {ia.complianceRedFlags.length} 处
          </h3>
          <p className="mt-0.5 text-xs text-red-600">
            涉及婚育/年龄/籍贯/健康等，不计入任何评分，但需在流程上纠正。
          </p>
          <div className="mt-2 space-y-1.5">
            {ia.complianceRedFlags.map((f, i) => (
              <div key={i} className="rounded bg-white p-2 text-xs">
                <Badge tone="red">{f.category}</Badge>
                <p className="mt-1 text-neutral-700">「{f.excerpt}」</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {strengths && weaknesses && (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-emerald-700">
              亮点（{strengths.length}）
            </h3>
            <div className="space-y-2">
              {strengths.map((s, i) => (
                <div key={i} className="rounded border border-emerald-200 p-2.5">
                  <p className="text-sm">{s.point}</p>
                  {s.evidence && (
                    <p className="mt-1 text-xs italic text-neutral-500">
                      「{s.evidence}」
                    </p>
                  )}
                </div>
              ))}
              {strengths.length === 0 && (
                <p className="text-xs text-neutral-400">无</p>
              )}
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-red-700">
              不足（{weaknesses.length}）
            </h3>
            <div className="space-y-2">
              {weaknesses.map((s, i) => (
                <div key={i} className="rounded border border-red-200 p-2.5">
                  <p className="text-sm">{s.point}</p>
                  {s.evidence && (
                    <p className="mt-1 text-xs italic text-neutral-500">
                      「{s.evidence}」
                    </p>
                  )}
                </div>
              ))}
              {weaknesses.length === 0 && (
                <p className="text-xs text-neutral-400">无</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-medium">
          失分归因
          <span className="ml-2 text-xs font-normal text-neutral-500">
            区分「人不行」和「没问到」
          </span>
        </h3>
        <div className="space-y-1.5">
          {attribution.map((a, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded border border-neutral-200 p-2.5"
            >
              <Badge tone={causeTone(a.cause)}>{a.cause}</Badge>
              <div className="flex-1">
                <p className="text-sm">{a.topic}</p>
                {a.evidence && (
                  <p className="mt-0.5 text-xs italic text-neutral-500">
                    「{a.evidence}」
                  </p>
                )}
              </div>
            </div>
          ))}
          {attribution.length === 0 && (
            <p className="text-xs text-neutral-400">无</p>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">面试官提问质量</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <MiniStat
            label="追问深度"
            value={`${ia.avgFollowupDepth.toFixed(1)} 层`}
            warn={ia.avgFollowupDepth < 1}
          />
          <MiniStat
            label="跑题率"
            value={`${Math.round(ia.offTopicRatio * 100)}%`}
            warn={ia.offTopicRatio > 0.2}
          />
          <MiniStat
            label="诱导性提问"
            value={`${ia.leadingQuestions.length} 处`}
            warn={ia.leadingQuestions.length > 0}
          />
          <MiniStat
            label="必问命中"
            value={`${Math.round(ia.mustHitRate * 100)}%`}
            warn={ia.mustHitRate < 0.7}
          />
        </div>

        {ia.leadingQuestions.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {ia.leadingQuestions.map((l, i) => (
              <div key={i} className="rounded bg-amber-50 p-2 text-xs">
                <p className="text-neutral-700">「{l.excerpt}」</p>
                <p className="mt-0.5 text-amber-700">{l.reason}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {digDeeper && digDeeper.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">下一轮可深挖</h3>
          <div className="space-y-1.5">
            {digDeeper.map((d, i) => (
              <div key={i} className="rounded border border-neutral-200 p-2.5">
                <p className="text-sm font-medium">{d.topic}</p>
                <p className="mt-0.5 text-xs text-neutral-600">{d.suggestion}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {unverifiedQuotes && unverifiedQuotes.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-800">
            {unverifiedQuotes.length} 条引用未能在纪要中精确定位（可能为轻微改写），
            相关结论请人工复核：
          </p>
          <ul className="mt-1 space-y-0.5">
            {unverifiedQuotes.slice(0, 3).map((q, i) => (
              <li key={i} className="text-xs italic text-amber-700">
                「{q.slice(0, 60)}」
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-neutral-400">
        本报告由 AI 生成，仅作辅助参考，不能作为唯一筛选依据。
      </p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded border p-2.5 ${warn ? "border-amber-300 bg-amber-50" : "border-neutral-200"}`}
    >
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
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
