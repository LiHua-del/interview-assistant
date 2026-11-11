import Link from "next/link";
import { db } from "@/lib/db";
import { jobs, candidates, rounds, reviews } from "@/lib/db/schema";
import { Card, Stat, Empty, SectionTitle, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function Home() {
  const allJobs = db.select().from(jobs).all();
  const allCandidates = db.select().from(candidates).all();
  const allRounds = db.select().from(rounds).all();
  const allReviews = db.select().from(reviews).all();

  const byStatus = allCandidates.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});

  const verdicts = allReviews.reduce<Record<string, number>>((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">概览</h1>
        <p className="mt-1 text-sm text-neutral-500">
          简历出题 · 面试复盘 · 候选人归档
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link href="/jobs" aria-label="查看岗位列表" className="rounded-lg transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
          <Stat label="岗位" value={allJobs.length} hint="查看岗位 →" />
        </Link>
        <Link href="/candidates" aria-label="查看候选人列表" className="rounded-lg transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
          <Stat label="候选人" value={allCandidates.length} hint="查看候选人 →" />
        </Link>
        <Stat label="面试轮次" value={allRounds.length} />
        <Stat label="已出评估" value={allReviews.length} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <SectionTitle hint="按当前状态统计">候选人状态</SectionTitle>
          {Object.keys(byStatus).length === 0 ? (
            <p className="text-sm text-neutral-500">暂无候选人</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(byStatus).map(([k, v]) => (
                <span key={k} className="text-sm">
                  <Badge tone={statusTone(k)}>
                    {k} {v}
                  </Badge>
                </span>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle hint="AI 结论分布，仅供参考">筛选结论</SectionTitle>
          {Object.keys(verdicts).length === 0 ? (
            <p className="text-sm text-neutral-500">暂无评估结果</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(verdicts).map(([k, v]) => (
                <Badge key={k} tone={verdictTone(k)}>
                  {k} {v}
                </Badge>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div>
        <SectionTitle>最近候选人</SectionTitle>
        {allCandidates.length === 0 ? (
          <Empty>
            还没有候选人。
            <Link href="/candidates" className="underline ml-1">
              去添加
            </Link>
          </Empty>
        ) : (
          <div className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
            {[...allCandidates]
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, 6)
              .map((c) => (
                <Link
                  key={c.id}
                  href={`/candidates/${c.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-neutral-50"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{c.name}</span>
                    <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                    {c.riskReport.some((r) => r.severity === "高") && (
                      <Badge tone="red">
                        高危可疑点 {c.riskReport.filter((r) => r.severity === "高").length}
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-neutral-400">
                    {new Date(c.createdAt * 1000).toLocaleDateString("zh-CN")}
                  </span>
                </Link>
              ))}
          </div>
        )}
      </div>
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
