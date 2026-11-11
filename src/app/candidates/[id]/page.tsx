import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { candidates, jobs, questionSets, rounds, reviews } from "@/lib/db/schema";
import { Card, SectionTitle, Badge, CollapsibleCard } from "@/components/ui";
import { GeneratePanel } from "@/components/GeneratePanel";
import { ReviewPanel } from "@/components/ReviewPanel";

export const dynamic = "force-dynamic";

export default async function CandidateDetail({
  params,
}: PageProps<"/candidates/[id]">) {
  const { id } = await params;
  const c = db.select().from(candidates).where(eq(candidates.id, id)).get();
  if (!c) notFound();

  const allJobs = db.select().from(jobs).all();
  const sets = db.select().from(questionSets).where(eq(questionSets.candidateId, id)).all();
  const rds = db.select().from(rounds).where(eq(rounds.candidateId, id)).all();
  const rvs = db.select().from(reviews).all();

  const highRisks = c.riskReport.filter((r) => r.severity === "高");
  const midRisks = c.riskReport.filter((r) => r.severity === "中");
  const lowRisks = c.riskReport.filter((r) => r.severity === "低");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/candidates" className="text-sm text-neutral-500 hover:underline">
          ← 候选人列表
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <Badge tone={statusTone(c.status)}>{c.status}</Badge>
          <Link href={`/candidates/${c.id}/interview`} className="ml-auto rounded-md bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900">
            进入面试模式 →
          </Link>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          {c.resumeFormat === "pdf" ? "PDF" : "Markdown"} · 解析{" "}
          {c.resumeParsed.charCount} 字符 · 上传于{" "}
          {new Date(c.createdAt * 1000).toLocaleDateString("zh-CN")}
        </p>
      </div>

      {/* 风险扫描 —— 本工具的核心差异点 */}
      <CollapsibleCard title="简历风险扫描" hint={`高危 ${highRisks.length} · 中 ${midRisks.length} · 低 ${lowRisks.length}`}>
        {c.riskReport.length === 0 ? (
          <p className="text-sm text-neutral-500">未发现明显可疑点。</p>
        ) : (
          <div className="space-y-2">
            {c.riskReport.map((r, i) => (
              <div
                key={i}
                className={`rounded border p-3 ${
                  r.severity === "高"
                    ? "border-red-200 bg-red-50/50"
                    : r.severity === "中"
                      ? "border-amber-200 bg-amber-50/40"
                      : "border-neutral-200"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Badge
                    tone={
                      r.severity === "高"
                        ? "red"
                        : r.severity === "中"
                          ? "amber"
                          : "neutral"
                    }
                  >
                    {r.severity}
                  </Badge>
                  <span className="text-sm font-medium">{r.type}</span>
                </div>
                <p className="mt-1.5 text-sm text-neutral-700">{r.reason}</p>
                <p className="mt-1.5 text-xs text-neutral-500">
                  <span className="font-medium">简历原文：</span>
                  <span className="italic">「{r.anchor}」</span>
                </p>
                <p className="mt-1 text-xs text-neutral-600">
                  <span className="font-medium">验真方向：</span>
                  {r.probeDirection}
                </p>
              </div>
            ))}
          </div>
        )}
      </CollapsibleCard>

      {/* 简历结构化结果 */}
      <div className="grid md:grid-cols-2 gap-6">
        <CollapsibleCard title="实习经历" hint={`${c.resumeParsed.internships.length} 段`}>
          {c.resumeParsed.internships.length === 0 ? (
            <p className="text-sm text-neutral-500">无</p>
          ) : (
            <div className="space-y-3">
              {c.resumeParsed.internships.map((x, i) => (
                <div key={i} className="border-l-2 border-neutral-200 pl-3">
                  <div className="text-sm font-medium">
                    {x.company} · {x.role}
                  </div>
                  <div className="text-xs text-neutral-500">{x.period}</div>
                  <p className="mt-1 text-xs text-neutral-600">{x.details}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {x.techStack.map((t, j) => (
                      <Badge key={j}>{t}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleCard>

        <CollapsibleCard title="项目经历" hint={`${c.resumeParsed.projects.length} 个`}>
          {c.resumeParsed.projects.length === 0 ? (
            <p className="text-sm text-neutral-500">无</p>
          ) : (
            <div className="space-y-3">
              {c.resumeParsed.projects.map((x, i) => (
                <div key={i} className="border-l-2 border-neutral-200 pl-3">
                  <div className="text-sm font-medium">{x.name}</div>
                  <div className="text-xs text-neutral-500">{x.period}</div>
                  <p className="mt-1 text-xs text-neutral-600">{x.background}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {x.techStack.map((t, j) => (
                      <Badge key={j}>{t}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleCard>
      </div>

      <CollapsibleCard title="技能" hint={`${c.resumeParsed.skills.length} 项`}>
        <div className="flex flex-wrap gap-1.5">
          {c.resumeParsed.skills.map((s, i) => (
            <Badge key={i}>{s}</Badge>
          ))}
        </div>
      </CollapsibleCard>

      {/* 模块一：出题 */}
      <div id="generate">
      <GeneratePanel
        candidateId={c.id}
        jobs={allJobs.map((j) => ({
          id: j.id,
          title: j.title,
          config: j.questionConfig,
        }))}
        existingSets={[...sets]
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((s) => ({
            id: s.id,
            jobId: s.jobId,
            createdAt: s.createdAt,
            count: s.questions.length,
            followupLevels: s.configSnapshot?.candidate?.followupLevels,
            questions: s.questions,
            reusablePrompt: s.reusablePrompt,
            sources: s.configSnapshot?.sources ?? null,
            distribution: s.questions.reduce<Record<string, number>>((acc, q) => {
              acc[q.category] = (acc[q.category] ?? 0) + 1;
              return acc;
            }, {}),
          }))}
      />
      </div>

      {/* 模块二：复盘 */}
      <ReviewPanel
        candidateId={c.id}
        jobs={allJobs.map((j) => ({ id: j.id, title: j.title }))}
        hasQuestionSet={sets.length > 0}
      />

      {/* 历史轮次 */}
      {rds.length > 0 && (
        <Card>
          <SectionTitle>面试轮次</SectionTitle>
          <div className="space-y-2">
            {rds.map((r) => {
              const rv = rvs.find((x) => x.roundId === r.id);
              return (
                <Link
                  key={r.id}
                  href={`/candidates/${c.id}/rounds/${r.id}`}
                  className="flex items-center justify-between rounded border border-neutral-200 px-4 py-2.5 text-sm hover:bg-neutral-50"
                >
                  <span>第 {r.seq} 轮</span>
                  <span className="flex items-center gap-2">
                    {rv && (
                      <Badge tone={verdictTone(rv.verdict)}>{rv.verdict}</Badge>
                    )}
                    <span className="text-xs text-neutral-400">
                      {new Date(r.createdAt * 1000).toLocaleDateString("zh-CN")}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

function statusTone(s: string) {
  if (s.includes("通过") || s.includes("offer")) return "green" as const;
  if (s.includes("拒")) return "red" as const;
  if (s.includes("待定") || s.includes("待复盘")) return "amber" as const;
  return "neutral" as const;
}

function verdictTone(v: string) {
  if (v.includes("强烈")) return "green" as const;
  if (v.includes("不推荐")) return "red" as const;
  if (v.includes("待定")) return "amber" as const;
  return "blue" as const;
}
