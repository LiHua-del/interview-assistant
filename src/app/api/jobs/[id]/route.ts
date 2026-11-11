import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, rounds, candidates } from "@/lib/db/schema";

/**
 * 删除岗位时，评估报告与题单由外键级联删除。
 * 但轮次引用候选人，删岗位不应连带删除候选人本身，
 * 所以先查一下有多少候选人会失去这次面试记录，返回给前端提示。
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const job = db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!job) {
    return NextResponse.json({ error: "岗位不存在" }, { status: 404 });
  }

  const affectedRounds = db
    .select()
    .from(rounds)
    .where(eq(rounds.jobId, id))
    .all();

  const affectedCandidates =
    affectedRounds.length > 0
      ? db
          .select()
          .from(candidates)
          .all()
          .filter((c) => affectedRounds.some((r) => r.candidateId === c.id))
          .map((c) => c.name)
      : [];

  db.delete(jobs).where(eq(jobs.id, id)).run();

  return NextResponse.json({
    ok: true,
    title: job.title,
    affectedCandidates,
  });
}
