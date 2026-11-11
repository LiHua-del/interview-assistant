import Link from "next/link";
import { db } from "@/lib/db";
import { jobs, candidates, questionSets, reviews, rounds } from "@/lib/db/schema";
import { Card, Empty, Badge } from "@/components/ui";
import { CandidateUploadForm } from "@/components/CandidateUploadForm";
import { DeleteButton } from "@/components/DeleteButton";

export const dynamic = "force-dynamic";

export default function CandidatesPage() {
  const allJobs = db.select().from(jobs).all();
  const allCandidates = db.select().from(candidates).all();
  const allSets = db.select().from(questionSets).all();
  const allRounds = db.select().from(rounds).all();
  const allReviews = db.select().from(reviews).all();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">候选人</h1>
          <p className="mt-1 text-sm text-neutral-500">
            上传简历即触发解析与风险扫描，可疑点会直接变成优先级最高的面试题。
          </p>
        </div>
        <CandidateUploadForm
          jobs={allJobs.map((j) => ({ id: j.id, title: j.title }))}
        />
      </div>

      {allCandidates.length === 0 ? (
        <Empty>还没有候选人，先上传一份简历。</Empty>
      ) : (
        <div className="space-y-3">
          {[...allCandidates]
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((c) => {
              const sets = allSets.filter((s) => s.candidateId === c.id);
              const rds = allRounds.filter((r) => r.candidateId === c.id);
              const rvs = allReviews.filter((r) =>
                rds.some((x) => x.id === r.roundId),
              );
              const highRisks = c.riskReport.filter((r) => r.severity === "高");
              return (
                <Card key={c.id} className="hover:border-neutral-300 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/candidates/${c.id}`}
                      className="flex-1 min-w-0"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="font-medium">{c.name}</span>
                        <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                        {highRisks.length > 0 && (
                          <Badge tone="red">高危 {highRisks.length}</Badge>
                        )}
                        {rvs.at(-1) && (
                          <Badge tone={verdictTone(rvs.at(-1)!.verdict)}>
                            {rvs.at(-1)!.verdict}
                          </Badge>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {c.resumeParsed.internships.slice(0, 3).map((i, idx) => (
                          <Badge key={idx}>{i.company || "实习"}</Badge>
                        ))}
                        {c.resumeParsed.skills.slice(0, 6).map((s, idx) => (
                          <Badge key={`s${idx}`}>{s}</Badge>
                        ))}
                      </div>

                      {highRisks.length > 0 && (
                        <p className="mt-2 text-xs text-red-600">
                          最高危：{highRisks[0].type} — {highRisks[0].reason.slice(0, 50)}
                        </p>
                      )}
                    </Link>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className="text-xs text-neutral-400">
                        {sets.length} 份题单 · {rds.length} 轮面试
                      </span>
                      <DeleteButton
                        endpoint={`/api/candidates/${c.id}`}
                        name={c.name}
                        warning={
                          sets.length + rds.length > 0
                            ? `该候选人已有 ${sets.length} 份题单、${rds.length} 轮面试记录，删除后一并清除，且会上传的简历文件一并删除。`
                            : "删除后简历文件将一并从本地移除。"
                        }
                      />
                    </div>
                  </div>
                </Card>
              );
            })}
        </div>
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
