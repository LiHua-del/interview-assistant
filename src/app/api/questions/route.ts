import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { candidates, jobs, questionSets } from "@/lib/db/schema";
import {
  generateQuestions,
  validateJobConfig,
  DEFAULT_CANDIDATE_CONFIG,
} from "@/lib/questions/generate";
import type { CandidateQuestionConfig } from "@/lib/db/schema";
import { LLMError } from "@/lib/llm/client";
import { loadResumeDocument } from "@/lib/resume/parse";
import { resolveResumeAnchor } from "@/lib/resume/document";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      jobId?: string;
      candidateId?: string;
      personalizedCount?: number;
      personalizedBias?: CandidateQuestionConfig["personalizedBias"];
      followupLevels?: number;
    };

    if (!body.jobId || !body.candidateId) {
      return NextResponse.json(
        { error: "缺少 jobId 或 candidateId" },
        { status: 400 },
      );
    }

    const job = db.select().from(jobs).where(eq(jobs.id, body.jobId)).get();
    if (!job) {
      return NextResponse.json({ error: "岗位不存在" }, { status: 404 });
    }

    const candidate = db
      .select()
      .from(candidates)
      .where(eq(candidates.id, body.candidateId))
      .get();
    if (!candidate) {
      return NextResponse.json({ error: "候选人不存在" }, { status: 404 });
    }

    const jobErrors = validateJobConfig(job.questionConfig);
    if (jobErrors.length) {
      return NextResponse.json(
        { error: `岗位题数配置有误：${jobErrors.join("；")}` },
        { status: 422 },
      );
    }

    const candidateConfig: CandidateQuestionConfig = {
      ...DEFAULT_CANDIDATE_CONFIG,
      ...(body.personalizedCount !== undefined && {
        personalizedCount: body.personalizedCount,
      }),
      ...(body.personalizedBias && {
        personalizedBias: body.personalizedBias,
      }),
      ...(body.followupLevels && {
        followupLevels: Math.min(5, Math.max(2, body.followupLevels)),
      }),
    };

    const result = await generateQuestions({
      jd: job.jdSnapshot,
      parsed: { ...candidate.resumeParsed, document: undefined },
      rawText: candidate.resumeRawText,
      risks: candidate.riskReport,
      jobConfig: job.questionConfig,
      candidateConfig,
      jobTitle: job.title,
    });

    const id = randomUUID();
    const document = await loadResumeDocument(candidate);
    const questions = result.questions.map((question) => ({
      ...question,
      resumeReference: resolveResumeAnchor(document, question.resumeAnchor),
    }));
    db.insert(questionSets)
      .values({
        id,
        jobId: job.id,
        candidateId: candidate.id,
        isBase: false,
        questions,
        configSnapshot: {
          job: job.questionConfig,
          candidate: candidateConfig,
          sources: result.sources,
        },
        reusablePrompt: result.reusablePrompt,
      })
      .run();

    return NextResponse.json({
      id,
      savedId: id,
      savedAt: Math.floor(Date.now() / 1000),
      questions,
      reusablePrompt: result.reusablePrompt,
      dropped: result.dropped,
      warnings: result.warnings,
      distribution: result.distribution,
      sources: result.sources,
    });
  } catch (err) {
    if (err instanceof LLMError) {
      return NextResponse.json(
        { error: `${err.message}${err.detail ? `：${err.detail}` : ""}` },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "出题失败" },
      { status: 500 },
    );
  }
}

/** 取某候选人在某岗位下最近一次题单 */
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  const candidateId = req.nextUrl.searchParams.get("candidateId");
  if (!jobId || !candidateId) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }
  const row = db
    .select()
    .from(questionSets)
    .where(
      and(
        eq(questionSets.jobId, jobId),
        eq(questionSets.candidateId, candidateId),
      ),
    )
    .all()
    .sort((a, b) => b.createdAt - a.createdAt)[0];

  if (!row) return NextResponse.json({ error: "尚未出题" }, { status: 404 });
  return NextResponse.json(row);
}
