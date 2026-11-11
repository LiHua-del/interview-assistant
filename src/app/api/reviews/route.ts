import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { candidates, jobs, questionSets, rounds, reviews } from "@/lib/db/schema";
import { reviewRound, ReviewError } from "@/lib/review/analyze";
import { LLMError } from "@/lib/llm/client";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      candidateId?: string;
      jobId?: string;
      transcript?: string;
      notes?: string;
    };

    if (!body.candidateId || !body.jobId || !body.transcript?.trim()) {
      return NextResponse.json(
        { error: "缺少候选人、岗位或面试纪要" },
        { status: 400 },
      );
    }

    const job = db.select().from(jobs).where(eq(jobs.id, body.jobId)).get();
    if (!job) return NextResponse.json({ error: "岗位不存在" }, { status: 404 });

    const qset = db
      .select()
      .from(questionSets)
      .where(eq(questionSets.candidateId, body.candidateId))
      .all()
      .filter((r) => r.jobId === body.jobId)
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    const result = await reviewRound({
      transcript: body.transcript,
      notes: body.notes,
      rubric: job.rubric,
      questions: qset?.questions ?? [],
    });

    const roundId = randomUUID();
    const existing = db
      .select()
      .from(rounds)
      .where(eq(rounds.candidateId, body.candidateId))
      .all()
      .filter((r) => r.jobId === body.jobId);

    db.insert(rounds)
      .values({
        id: roundId,
        candidateId: body.candidateId,
        jobId: body.jobId,
        questionSetId: qset?.id ?? null,
        seq: existing.length + 1,
        transcript: body.transcript,
        notes: body.notes ?? null,
      })
      .run();

    const reviewId = randomUUID();
    db.insert(reviews)
      .values({
        id: reviewId,
        roundId,
        metrics: result.metrics,
        verdict: result.verdict,
        attribution: result.attribution,
        interviewerAnalysis: result.interviewerAnalysis,
      })
      .run();

    return NextResponse.json({ roundId, reviewId, review: result });
  } catch (err) {
    if (err instanceof ReviewError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof LLMError) {
      return NextResponse.json(
        { error: `${err.message}${err.detail ? `：${err.detail}` : ""}` },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "复盘失败" },
      { status: 500 },
    );
  }
}
