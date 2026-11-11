import { askJson } from "@/lib/llm/client";
import { REVIEW, REVIEW_INTERVIEWER } from "@/lib/prompts";
import {
  candidateReviewSchema,
  interviewerReviewSchema,
  type ReviewResult,
} from "@/lib/llm/schemas";
import {
  normalizeCandidateReview,
  normalizeInterviewerReview,
} from "@/lib/llm/normalize";
import {
  computeCoverage,
  computeHitRate,
  computeWeightedTotal,
} from "@/lib/review/metrics";
import type {
  InterviewQuestion,
  RubricDimension,
} from "@/lib/db/schema";

export type ReviewInput = {
  transcript: string;
  notes?: string;
  rubric: RubricDimension[];
  questions: InterviewQuestion[];
};

export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewError";
  }
}

export async function reviewRound(input: ReviewInput): Promise<ReviewResult> {
  const questionSet = input.questions
    .map(
      (q) =>
        `[${q.priority}] ${q.category} | ${q.question}\n` +
        `  考察点：${q.dimension}\n` +
        `  评分要点：${q.expectedPoints.join("；")}`,
    )
    .join("\n");

  // 两次调用并行：候选人评估 + 面试官提问质量
  // 合在一次调用里输出过长，上游会截断并报 unexpected EOF
  const [candidate, interviewer] = await Promise.all([
    askJson(
      REVIEW.system,
      REVIEW.user({
        transcript: input.transcript,
        notes: input.notes ?? "",
        rubric: input.rubric
          .map((d) => `${d.name}(key=${d.key}, 权重=${d.weight}%)`)
          .join("\n"),
        questionSet,
      }),
      candidateReviewSchema,
      {
        temperature: 0.2,
        retries: 2,
        preprocess: normalizeCandidateReview,
      },
    ),
    askJson(
      REVIEW_INTERVIEWER.system,
      REVIEW_INTERVIEWER.user({
        transcript: input.transcript,
        questionSet,
      }),
      interviewerReviewSchema,
      {
        temperature: 0.2,
        retries: 2,
        preprocess: normalizeInterviewerReview,
      },
    ),
  ]);

  // 防幻觉校验：标记出纪要中定位不到的引用。
  // 不直接拒绝整份报告——模型常有轻微改写，用户需要看到其余有效结论，
  // 但未核验的引用必须在界面上标出来。
  const unverifiedQuotes = new Set<string>();

  for (const item of [...candidate.strengths, ...candidate.weaknesses]) {
    if (item.evidence && !quoteExists(item.evidence, input.transcript)) {
      unverifiedQuotes.add(item.evidence);
    }
  }
  for (const a of candidate.attribution) {
    if (a.evidence && !quoteExists(a.evidence, input.transcript)) {
      unverifiedQuotes.add(a.evidence);
    }
  }
  for (const f of interviewer.complianceRedFlags) {
    if (!quoteExists(f.excerpt, input.transcript)) unverifiedQuotes.add(f.excerpt);
  }
  for (const l of interviewer.leadingQuestions) {
    if (!quoteExists(l.excerpt, input.transcript)) unverifiedQuotes.add(l.excerpt);
  }

  // 覆盖率与命中率改为本地确定性计算——模型算这两个数不可靠
  const coverage = computeCoverage(input.questions, input.transcript);
  const hitRate = computeHitRate(input.questions, input.transcript);

  // 数值自洽
  const fixed = { ...candidate };
  fixed.metrics = {
    ...candidate.metrics,
    coverage,
    hitRate,
    weightedTotal: computeWeightedTotal(candidate.metrics.dimensions, input.rubric),
  };
  fixed.attribution = sanitizeAttribution(candidate.attribution);
  const redFlags = dedupeRedFlags(interviewer.complianceRedFlags);

  return {
    ...fixed,
    interviewerAnalysis: {
      ...interviewer,
      mustHitRate: coverage.ratio,
      complianceRedFlags: redFlags,
    },
    unverifiedQuotes: [...unverifiedQuotes],
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 清理空 topic、重复归因 */
function sanitizeAttribution(
  items: ReviewResult["attribution"],
): ReviewResult["attribution"] {
  const seen = new Set<string>();
  return items
    .map((a) => ({
      ...a,
      topic: a.topic.trim() || a.evidence.slice(0, 30) || "未标注考察点",
    }))
    .filter((a) => {
      const key = `${a.cause}|${a.topic}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** 同一句提问可能被归到多个合规类别，按原文去重 */
function dedupeRedFlags(
  flags: ReviewResult["interviewerAnalysis"]["complianceRedFlags"],
): ReviewResult["interviewerAnalysis"]["complianceRedFlags"] {
  const seen = new Set<string>();
  return flags.filter((f) => {
    if (seen.has(f.excerpt)) return false;
    seen.add(f.excerpt);
    return true;
  });
}

function quoteExists(quote: string, transcript: string): boolean {
  const norm = (s: string) =>
    s.replace(/\s+/g, "").replace(/[，。、；：""''？！…—\-（）()【】]/g, "");
  const q = norm(quote);
  if (q.length < 4) return false;
  return norm(transcript).includes(q);
}
