import { z } from "zod";

/** 模型常输出「实习」「项目」「技术」等简写，统一归一化 */
const CATEGORY = z
  .string()
  .transform((v) => {
    if (v.includes("实习")) return "实习经历" as const;
    if (v.includes("项目")) return "项目经历" as const;
    if (v.includes("技术") || v.includes("基础") || v.includes("原理"))
      return "技术基础" as const;
    if (
      v.includes("软") ||
      v.includes("素质") ||
      v.includes("岗位") ||
      v.includes("沟通") ||
      v.includes("协作")
    )
      return "软素质" as const;
    // 出题 prompt 现在强调按"考察意图"分类（真实性/故障排查/选型…），
    // 这些都归入技术基础，具体意图记在 dimension 里
    return "技术基础" as const;
  })
  .pipe(z.enum(["实习经历", "项目经历", "技术基础", "软素质"]));

const PRIORITY = z
  .string()
  .transform((v) => {
    if (v.includes("必")) return "必问" as const;
    if (v.includes("备")) return "备用" as const;
    return "选问" as const;
  })
  .pipe(z.enum(["必问", "选问", "备用"]));

/** 模型可能给 "高"/"中"/"低" 或 "1"-"5" */
const DIFFICULTY = z
  .union([z.number(), z.string()])
  .transform((v) => {
    if (typeof v === "number") return Math.min(5, Math.max(1, Math.round(v)));
    const map: Record<string, number> = { 低: 2, 中: 3, 高: 4, 极高: 5 };
    for (const [k, n] of Object.entries(map)) if (v.includes(k)) return n;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3;
  })
  .pipe(z.number().min(1).max(5));

const FOLLOWUP_LEVEL = z
  .union([z.number(), z.string()])
  .transform((v) => {
    const n = typeof v === "number" ? v : Number(v);
    return n === 1 || n === 2 || n === 3 ? (n as 1 | 2 | 3) : 1;
  })
  .pipe(z.union([z.literal(1), z.literal(2), z.literal(3)]));

export const parsedResumeSchema = z.object({
  basic: z.object({
    name: z.string().default(""),
    education: z
      .array(
        z.object({
          school: z.string().default(""),
          major: z.string().default(""),
          degree: z.string().default(""),
          period: z.string().default(""),
        }),
      )
      .default([]),
  }),
  internships: z
    .array(
      z.object({
        company: z.string().default(""),
        role: z.string().default(""),
        period: z.string().default(""),
        details: z.string().default(""),
        techStack: z.array(z.string()).default([]),
        raw: z.string().default(""),
      }),
    )
    .default([]),
  projects: z
    .array(
      z.object({
        name: z.string().default(""),
        period: z.string().default(""),
        background: z.string().default(""),
        role: z.string().default(""),
        techStack: z.array(z.string()).default([]),
        achievements: z.array(z.string()).default([]),
        raw: z.string().default(""),
      }),
    )
    .default([]),
  skills: z.array(z.string()).default([]),
  timeline: z
    .array(z.object({ event: z.string(), period: z.string() }))
    .default([]),
});

export const riskFindingsSchema = z.array(
  z.object({
    type: z.enum([
      "时间线异常",
      "技术栈穿越",
      "指标不可信",
      "角色夸大",
      "深度不匹配",
      "技能堆砌",
    ]),
    anchor: z.string().min(1),
    reason: z.string().min(1),
    probeDirection: z.string().min(1),
    severity: z.enum(["高", "中", "低"]),
  }),
);

const questionSchema = z.object({
  category: CATEGORY,
  priority: PRIORITY,
  personalized: z.boolean().default(false),
  resumeAnchor: z.string().default(""),
  scene: z.string().default(""),
  tech: z.string().default(""),
  depth: z.string().default(""),
  dimension: z.string().default(""),
  question: z.string().min(1),
  followups: z
    .array(
      z.object({
        level: FOLLOWUP_LEVEL,
        trigger: z.string().default(""),
        question: z.string().min(1),
      }),
    )
    .default([]),
  expectedPoints: z.array(z.string()).default([]),
  goodSignals: z.array(z.string()).default([]),
  redFlags: z.array(z.string()).default([]),
  difficulty: DIFFICULTY.default(3),
});

/** 模型返回的题单（不含 id，id 在入库时统一分配） */
export const questionListSchema = z.array(questionSchema);

/** 模型有时包一层 { questions: [...] } 或 { items: [...] } */
export function normalizeQuestionList(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Record<string, unknown>;
    for (const k of ["questions", "items", "list", "data", "questionList"]) {
      if (Array.isArray(o[k])) return o[k];
    }
  }
  return raw;
}

/** 模型可能用不同字段名，做宽松归一化 */
const softString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v ?? ""))
  .pipe(z.string());

const softNumber = z
  .union([z.number(), z.string(), z.undefined(), z.null()])
  .transform((v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (typeof v === "string") {
      const n = Number(v.replace(/[^\d.\-]/g, ""));
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  })
  .pipe(z.number());

const COUNT = softNumber;
const SCORE = z
  .union([z.number(), z.string()])
  .transform((v) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
  });

const RATIO = z
  .union([z.number(), z.string(), z.undefined(), z.null()])
  .transform((v) => {
    if (typeof v === "number") return v > 1 ? v / 100 : v;
    if (typeof v === "string") {
      const n = Number(v.replace("%", "").trim());
      if (!Number.isFinite(n)) return 0;
      return n > 1 ? n / 100 : n;
    }
    return 0;
  });

/** 候选人评估部分（与面试官分析分两次调用，避免单次输出过长被截断） */
export const candidateReviewSchema = z.object({
  metrics: z.object({
    coverage: z.object({
      asked: COUNT,
      total: COUNT,
      ratio: RATIO,
    }),
    hitRate: z.object({
      hit: COUNT,
      answered: COUNT.default(0),
      ratio: RATIO,
    }),
    dimensions: z.array(
      z.object({
        key: softString.default(""),
        name: softString,
        score: SCORE,
        weight: softNumber.default(0),
      }),
    ),
    weightedTotal: softNumber,
  }),
  verdict: z
    .string()
    .transform((v) =>
      v.includes("强烈")
        ? ("强烈推荐" as const)
        : v.includes("不")
          ? ("不推荐" as const)
          : v.includes("待定")
            ? ("待定" as const)
            : ("推荐" as const),
    )
    .pipe(z.enum(["强烈推荐", "推荐", "待定", "不推荐"])),
  verdictReason: softString,
  strengths: z
    .array(
      z.object({
        point: softString.default(""),
        evidence: softString.default(""),
      }),
    )
    .default([]),
  weaknesses: z
    .array(
      z.object({
        point: softString.default(""),
        evidence: softString.default(""),
      }),
    )
    .default([]),
  attribution: z.array(
    z.object({
      topic: softString,
      cause: z
        .string()
        .transform((v) =>
          v.includes("没问到")
            ? ("没问到" as const)
            : v.includes("偏")
              ? ("问偏了" as const)
              : v.includes("时间")
                ? ("时间不够" as const)
                : ("真不会" as const),
        )
        .pipe(z.enum(["真不会", "没问到", "问偏了", "时间不够"])),
      evidence: softString.default(""),
    }),
  ),
  digDeeper: z
    .array(
      z.object({
        topic: softString.default(""),
        suggestion: softString.default(""),
      }),
    )
    .default([]),
});

/** 面试官提问质量部分 */
export const interviewerReviewSchema = z.object({
  mustHitRate: RATIO,
  avgFollowupDepth: softNumber,
  offTopicRatio: RATIO,
  candidateTalkRatio: RATIO,
  leadingQuestions: z
    .array(
      z.object({
        excerpt: softString.default(""),
        reason: softString.default(""),
      }),
    )
    .default([]),
  timeDistribution: z
    .array(
      z.object({
        topic: softString.default(""),
        share: RATIO,
      }),
    )
    .default([]),
  complianceRedFlags: z
    .array(
      z.object({
        excerpt: softString.default(""),
        category: softString.default(""),
      }),
    )
    .default([]),
});

export type CandidateReview = z.infer<typeof candidateReviewSchema>;
export type InterviewerReview = z.infer<typeof interviewerReviewSchema>;
export type ReviewResult = CandidateReview & {
  interviewerAnalysis: InterviewerReview;
  /** 无法在纪要中定位的引用，界面上需标为"待核实" */
  unverifiedQuotes: string[];
};
