import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { candidates, jobs, rounds, reviews } from "@/lib/db/schema";
import { Card, SectionTitle, Badge } from "@/components/ui";
import { ReviewReportView } from "@/components/ReviewReportView";

export const dynamic = "force-dynamic";

export default async function RoundDetail({
  params,
}: PageProps<"/candidates/[id]/rounds/[rid]">) {
  const { id, rid } = await params;
  const c = db.select().from(candidates).where(eq(candidates.id, id)).get();
  const r = db.select().from(rounds).where(eq(rounds.id, rid)).get();
  if (!c || !r) notFound();

  const job = db.select().from(jobs).where(eq(jobs.id, r.jobId)).get();
  const rv = db.select().from(reviews).where(eq(reviews.roundId, rid)).get();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/candidates/${id}`}
          className="text-sm text-neutral-500 hover:underline"
        >
          ← {c.name}
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            第 {r.seq} 轮面试
          </h1>
          {rv && <Badge tone={verdictTone(rv.verdict)}>{rv.verdict}</Badge>}
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          {job?.title} ·{" "}
          {new Date(r.createdAt * 1000).toLocaleDateString("zh-CN")}
        </p>
      </div>

      {rv ? (
        <Card>
          <SectionTitle>评估报告</SectionTitle>
          <ReviewReportView
            metrics={rv.metrics}
            verdict={rv.verdict}
            attribution={rv.attribution}
            interviewerAnalysis={rv.interviewerAnalysis}
          />
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-neutral-500">该轮次尚未生成评估报告。</p>
        </Card>
      )}

      <Card>
        <SectionTitle hint={`${r.transcript.length} 字符`}>
          面试纪要
        </SectionTitle>
        <div className="prose-block max-h-96 overflow-y-auto rounded bg-neutral-50 p-4 text-sm">
          {r.transcript}
        </div>
      </Card>

      {r.notes && (
        <Card>
          <SectionTitle>面试官总结</SectionTitle>
          <p className="prose-block text-sm">{r.notes}</p>
        </Card>
      )}
    </div>
  );
}

function verdictTone(v: string) {
  if (v.includes("强烈")) return "green" as const;
  if (v.includes("不推荐")) return "red" as const;
  if (v.includes("待定")) return "amber" as const;
  return "blue" as const;
}
