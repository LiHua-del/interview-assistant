import Link from "next/link";
import { db } from "@/lib/db";
import { jobs, candidates, questionSets } from "@/lib/db/schema";
import { Card, Empty, SectionTitle, Badge } from "@/components/ui";
import { JobForm } from "@/components/JobForm";
import { DeleteButton } from "@/components/DeleteButton";

export const dynamic = "force-dynamic";

export default function JobsPage() {
  const allJobs = db.select().from(jobs).all();
  const allCandidates = db.select().from(candidates).all();
  const allSets = db.select().from(questionSets).all();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">岗位</h1>
          <p className="mt-1 text-sm text-neutral-500">
            题单基底与评分标准挂在岗位上，同岗位候选人共用，保证横向可比。
          </p>
        </div>
        <JobForm />
      </div>

      {allJobs.length === 0 ? (
        <Empty>还没有岗位，先新建一个。</Empty>
      ) : (
        <div className="space-y-4">
          {allJobs.map((j) => {
            const jobCands = allCandidates.filter((c) =>
              allSets.some(
                (s) => s.jobId === j.id && s.candidateId === c.id,
              ),
            );
            const cfg = j.questionConfig;
            return (
              <Card key={j.id}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold">{j.title}</h2>
                      {j.company && (
                        <span className="text-sm text-neutral-500">
                          {j.company}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone="blue">
                        必问 {cfg.baseMustCount} · 选问 {cfg.baseOptionalCount} · 备用{" "}
                        {cfg.baseReserveCount}
                      </Badge>
                      {Object.entries(cfg.categoryRatio).map(([k, v]) => (
                        <Badge key={k}>
                          {k} {v}%
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-sm text-neutral-500">
                      <div>{jobCands.length} 位候选人</div>
                    </div>
                    <DeleteButton
                      endpoint={`/api/jobs/${j.id}`}
                      name={j.title}
                      warning={
                        jobCands.length > 0
                          ? `该岗位下有 ${jobCands.length} 位候选人的面试记录，删除岗位会连带删除相关的题单与评估报告，但不会删除候选人本身。`
                          : "该岗位下暂无候选人记录。"
                      }
                    />
                  </div>
                </div>

                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-neutral-600 hover:text-neutral-900">
                    JD 与评分维度
                  </summary>
                  <div className="mt-3 space-y-3">
                    <div className="rounded bg-neutral-50 p-3 text-xs prose-block text-neutral-700 max-h-60 overflow-y-auto">
                      {j.jdSnapshot}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {j.rubric.map((r) => (
                        <Badge key={r.key} tone="purple">
                          {r.name} {r.weight}%
                        </Badge>
                      ))}
                    </div>
                  </div>
                </details>

                {jobCands.length > 0 && (
                  <div className="mt-4 border-t border-neutral-100 pt-3">
                    <SectionTitle>已出题的候选人</SectionTitle>
                    <div className="flex flex-wrap gap-2">
                      {jobCands.map((c) => (
                        <Link
                          key={c.id}
                          href={`/candidates/${c.id}`}
                          className="rounded border border-neutral-200 px-2.5 py-1 text-sm hover:bg-neutral-50"
                        >
                          {c.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
