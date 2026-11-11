import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { ResumeDocument, ResumeReference } from "@/lib/resume/document";

const now = sql`(unixepoch())`;

/** 岗位：题单基底与评分标准挂在这里，而非候选人 */
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  company: text("company"),
  jdSnapshot: text("jd_snapshot").notNull(),
  /** 评分维度与权重，JSON: RubricDimension[] */
  rubric: text("rubric", { mode: "json" }).$type<RubricDimension[]>().notNull(),
  /** §4.5 岗位层题数配置快照 */
  questionConfig: text("question_config", { mode: "json" })
    .$type<JobQuestionConfig>()
    .notNull(),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
});

export const candidates = sqliteTable("candidates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** 原始简历文件路径（data/uploads/...） */
  resumeFile: text("resume_file"),
  resumeFormat: text("resume_format", { mode: "json" })
    .$type<"pdf" | "markdown">()
    .notNull(),
  /** 原始文本，用于题目的 resume_anchor 回查校验 */
  resumeRawText: text("resume_raw_text").notNull(),
  /** 结构化解析结果，JSON: ParsedResume */
  resumeParsed: text("resume_parsed", { mode: "json" })
    .$type<ParsedResume>()
    .notNull(),
  /** 风险扫描结果，JSON: RiskFinding[] */
  riskReport: text("risk_report", { mode: "json" })
    .$type<RiskFinding[]>()
    .notNull(),
  /** 待面 / 已面待复盘 / 待定 / 已通过 / 已拒绝 / 已发offer */
  status: text("status").notNull().default("待面"),
  /** 自定义标签，JSON: string[] */
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  createdAt: integer("created_at").notNull().default(now),
});

export const questionSets = sqliteTable(
  "question_sets",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    /** null 表示该岗位的题单基底 */
    candidateId: text("candidate_id").references(() => candidates.id, {
      onDelete: "cascade",
    }),
    isBase: integer("is_base", { mode: "boolean" }).notNull().default(false),
    /** 题目列表，JSON: InterviewQuestion[] */
    questions: text("questions", { mode: "json" })
      .$type<InterviewQuestion[]>()
      .notNull(),
    /** 出题时的完整配置快照，保证历史题单可复现 */
    configSnapshot: text("config_snapshot", { mode: "json" })
      .$type<QuestionGenConfigSnapshot>()
      .notNull(),
    /** §4.7 可复用 prompt */
    reusablePrompt: text("reusable_prompt").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("idx_qsets_job").on(t.jobId, t.isBase)],
);

export const rounds = sqliteTable(
  "rounds",
  {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    questionSetId: text("question_set_id").references(() => questionSets.id, {
      onDelete: "set null",
    }),
    /** 第几轮 */
    seq: integer("seq").notNull().default(1),
    transcript: text("transcript").notNull(),
    /** 面试官总结，选填 */
    notes: text("notes"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("idx_rounds_candidate").on(t.candidateId)],
);

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  roundId: text("round_id")
    .notNull()
    .references(() => rounds.id, { onDelete: "cascade" }),
  /** 三指标 + 维度得分，JSON: ReviewMetrics */
  metrics: text("metrics", { mode: "json" }).$type<ReviewMetrics>().notNull(),
  /** 强烈推荐 / 推荐 / 待定 / 不推荐 */
  verdict: text("verdict").notNull(),
  /** 归因分析，JSON: AttributionItem[] */
  attribution: text("attribution", { mode: "json" })
    .$type<AttributionItem[]>()
    .notNull(),
  /** 面试官提问质量，JSON: InterviewerAnalysis */
  interviewerAnalysis: text("interviewer_analysis", { mode: "json" })
    .$type<InterviewerAnalysis>()
    .notNull(),
  createdAt: integer("created_at").notNull().default(now),
});

export const questionsPool = sqliteTable(
  "questions_pool",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull(),
    /** 岗位关键词，JSON: string[] */
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
    question: text("question").notNull(),
    /** 参考答案全文，来自 PDF */
    answer: text("answer").notNull().default(""),
    difficulty: integer("difficulty").notNull().default(3),
    source: text("source").notNull().default("manual"),
    /** 原始出处 PDF 的文件标识 */
    sourceFile: text("source_file"),
    /** 被合并的相似题目数（去重时统计），用于判断该题的高频程度 */
    duplicates: integer("duplicates").notNull().default(0),
    /** 收藏标记：面试前会反复翻看的题 */
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("idx_pool_category").on(t.category),
    index("idx_pool_favorite").on(t.favorite),
  ],
);

// ---------- 领域类型 ----------

export type RubricDimension = {
  key: string;
  name: string;
  /** 权重，各项之和应为 100 */
  weight: number;
  description?: string;
};

export type JobQuestionConfig = {
  baseMustCount: number;
  baseOptionalCount: number;
  baseReserveCount: number;
  /** 各类别占比，四项之和 100 */
  categoryRatio: Record<QuestionCategory, number>;
};

export type CandidateQuestionConfig = {
  personalizedCount: number;
  personalizedBias: "risk" | "highlight" | "balanced";
  /** 每题的追问层数，默认 3；设为 4-5 可压得更深 */
  followupLevels: number;
};

export type QuestionGenConfigSnapshot = {
  job: JobQuestionConfig;
  candidate: CandidateQuestionConfig;
  /** 出题时实际采用的检索源，便于排查 */
  sources: { llm: boolean; web?: boolean; pool: boolean; techPoints?: number };
};

export type QuestionCategory = "实习经历" | "项目经历" | "技术基础" | "软素质";

export type InterviewQuestion = {
  /** 与原文阅读稿绑定的定位结果；旧题单读取时按原文重新解析。 */
  resumeReference?: ResumeReference;
  id: string;
  category: QuestionCategory;
  priority: "必问" | "选问" | "备用";
  /** 个性化增补题标记 */
  personalized: boolean;
  /** 简历原文片段，为空的题目在生成阶段即被丢弃 */
  resumeAnchor: string;
  /** 这道题锚定的场景：哪段实习 / 哪个项目 */
  scene: string;
  /** 这道题锚定的技术点，如 Kafka、Redis 预扣减 */
  tech: string;
  /** 简历对该技术点的描述程度，决定追问起点 */
  depth: string;
  dimension: string;
  question: string;
  followups: {
    level: 1 | 2 | 3 | 4 | 5;
    /** 触发条件：候选人答到什么程度才追问这一句 */
    trigger: string;
    question: string;
  }[];
  expectedPoints: string[];
  goodSignals: string[];
  redFlags: string[];
  difficulty: number;
};

export type ParsedResume = {
  /** 可选字段兼容已有 JSON；保留完整原文及页码，不替换结构化摘要。 */
  document?: ResumeDocument;
  basic: {
    name?: string;
    education: { school: string; major: string; degree: string; period: string }[];
  };
  internships: {
    company: string;
    role: string;
    period: string;
    details: string;
    techStack: string[];
    /** 简历原文片段 */
    raw: string;
  }[];
  projects: {
    name: string;
    period: string;
    background: string;
    role: string;
    techStack: string[];
    achievements: string[];
    raw: string;
  }[];
  skills: string[];
  timeline: { event: string; period: string }[];
  /** 抽取到的全文字符数，用于扫描件判定 */
  charCount: number;
};

export type RiskFinding = {
  type:
    | "时间线异常"
    | "技术栈穿越"
    | "指标不可信"
    | "角色夸大"
    | "深度不匹配"
    | "技能堆砌";
  anchor: string;
  reason: string;
  probeDirection: string;
  severity: "高" | "中" | "低";
};

export type ReviewMetrics = {
  /** 实际问到的必问题 / 必问题总数 */
  coverage: { asked: number; total: number; ratio: number };
  /** 命中期望要点的题 / 有效回答题数 */
  hitRate: { hit: number; answered: number; ratio: number };
  dimensions: { key: string; name: string; score: number; weight: number }[];
  weightedTotal: number;
};

export type AttributionItem = {
  /** 题目或考察点 */
  topic: string;
  /** 真不会 / 没问到 / 问偏了 / 时间不够 */
  cause: "真不会" | "没问到" | "问偏了" | "时间不够";
  /** 纪要原文引用，不允许为空 */
  evidence: string;
};

export type InterviewerAnalysis = {
  mustHitRate: number;
  avgFollowupDepth: number;
  offTopicRatio: number;
  leadingQuestions: { excerpt: string; reason: string }[];
  timeDistribution: { topic: string; share: number }[];
  candidateTalkRatio: number;
  /** 合规红线提问，单独标红且不计分 */
  complianceRedFlags: { excerpt: string; category: string }[];
};
