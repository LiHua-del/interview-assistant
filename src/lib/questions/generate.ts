import { askJson, askText } from "@/lib/llm/client";
import { QUESTION_GEN, REUSABLE_PROMPT } from "@/lib/prompts";
import { questionListSchema, normalizeQuestionList } from "@/lib/llm/schemas";
import { anchorExists } from "@/lib/resume/parse";
import { pickPoolQuestions } from "@/lib/questions/pool";
import { enrichQuestions } from "@/lib/questions/enrich";
import { rebalanceQuestions } from "@/lib/questions/rebalance";
import { extractTechPoints, groupByScene } from "@/lib/analysis/techpoints";
import type {
  CandidateQuestionConfig,
  InterviewQuestion,
  JobQuestionConfig,
  ParsedResume,
  RiskFinding,
} from "@/lib/db/schema";

const BIAS_TEXT: Record<CandidateQuestionConfig["personalizedBias"], string> = {
  risk: "全部来自风险扫描可疑点（验真优先）",
  highlight: "全部来自简历中被一笔带过但技术含量高的部分（挖亮点优先）",
  balanced: "风险可疑点与潜在亮点各占一半",
};

export type GenerateResult = {
  questions: InterviewQuestion[];
  reusablePrompt: string;
  dropped: { question: string; reason: string }[];
  warnings: string[];
  distribution: Record<string, number>;
  sources: { llm: boolean; pool: boolean; techPoints: number };
};

export async function generateQuestions(params: {
  jd: string;
  parsed: ParsedResume;
  rawText: string;
  risks: RiskFinding[];
  jobConfig: JobQuestionConfig;
  candidateConfig: CandidateQuestionConfig;
  jobTitle: string;
}): Promise<GenerateResult> {
  const { jobConfig, candidateConfig, rawText } = params;

  // 技术点是出题主轴：先还原"在哪个场景用了什么技术、用得多深"
  let techPoints: Awaited<ReturnType<typeof extractTechPoints>> = [];
  try {
    techPoints = await extractTechPoints(params.parsed, rawText, params.risks);
    console.error(`[generate] 技术点提取成功：${techPoints.length} 个`);
  } catch (e) {
    // 提取失败不阻断出题，退回到直接用简历结构化结果出题
    console.error(
      "[generate] 技术点提取失败，降级为仅用简历出题：",
      e instanceof Error ? e.message.slice(0, 300) : e,
    );
  }

  const byScene = groupByScene(techPoints);
  const techPointsText = [...byScene.entries()]
    .map(([scene, points]) => {
      const lines = points
        .map(
          (p) =>
            `  - ${p.tech}｜${p.depth}｜角色:${p.role}｜用途:${p.usage}\n` +
            `    原文:「${p.anchor}」\n` +
            `    深挖方向: ${p.probeAngles.join("；")}`,
        )
        .join("\n");
      return `【场景】${scene}\n${lines}`;
    })
    .join("\n\n");

  // 题库只用于确认该技术点的常见考察方向，不直接抄题
  const poolQuestions = pickPoolQuestions(params.jobTitle, params.jd);

  const categoryRatio = (Object.entries(jobConfig.categoryRatio) as [string, number][])
    .map(([k, v]) => `${k} ${v}%`)
    .join("，");

  const raw = await askJson(
    QUESTION_GEN.system,
    QUESTION_GEN.user({
      jd: params.jd,
      parsed: JSON.stringify(params.parsed, null, 2),
      risks: JSON.stringify(params.risks, null, 2),
      techPoints: techPointsText,
      mustCount: jobConfig.baseMustCount,
      optionalCount: jobConfig.baseOptionalCount,
      reserveCount: jobConfig.baseReserveCount,
      categoryRatio,
      poolQuestions: poolQuestions.map((q) => `- [${q.category}] ${q.question}`).join("\n"),
      personalizedCount: candidateConfig.personalizedCount,
      personalizedBias: BIAS_TEXT[candidateConfig.personalizedBias],
    }),
    questionListSchema,
    { temperature: 0.5, retries: 2, preprocess: normalizeQuestionList },
  );

  if (raw.length === 0) {
    console.error(
      `[generate] 模型返回空题单。技术点 ${techPoints.length} 个，` +
        `技术点文本 ${techPointsText.length} 字符，` +
        `题库候选 ${poolQuestions.length} 条`,
    );
    throw new Error(
      "模型未产出任何题目。请检查岗位 JD 与简历内容是否充足，或稍后重试。",
    );
  }

  // 场景与技术点回填：模型常漏填这两个字段，但它们是本工具的核心结构。
  // 用锚点去匹配技术点清单，命中的就补上——这是确定性补全，不引入幻觉。
  const norm = (s: string) =>
    s.replace(/\s+/g, "").replace(/[，。、；：""''？！…—\-（）()【】《》,.;:?!'"()\[\]]/g, "");

  for (const q of raw) {
    if (q.scene && q.tech) continue;
    const qAnchor = norm(q.resumeAnchor);
    if (!qAnchor) continue;

    const matched = techPoints
      .map((p) => {
        const pAnchor = norm(p.anchor);
        // 双向包含：技术点锚点更短时用它反查题目锚点
        const overlap =
          pAnchor.length >= 4 &&
          (qAnchor.includes(pAnchor) || pAnchor.includes(qAnchor) ||
            (pAnchor.length >= 6 && qAnchor.includes(pAnchor.slice(0, 10))));
        return overlap ? p : null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    if (!matched.length) continue;
    const best = matched[0];
    if (!q.scene && best.scene) q.scene = best.scene;
    if (!q.tech) q.tech = matched.map((p) => p.tech).join(" / ");
    if (!q.depth && best.depth) q.depth = best.depth;
  }

  // 防幻觉第一道闸：锚点必须能在简历原文里检索到
  const dropped: GenerateResult["dropped"] = [];
  const kept = raw.filter((q) => {
    if (!q.resumeAnchor) {
      // 通用题允许无锚点，但强制降级为选问/备用（已在 prompt 里要求，这里兜底）
      if (q.priority === "必问") {
        dropped.push({ question: q.question, reason: "必问题缺少简历锚点" });
        return false;
      }
      return true;
    }
    if (!anchorExists(q.resumeAnchor, rawText)) {
      dropped.push({ question: q.question, reason: "简历锚点在原文中检索不到" });
      return false;
    }
    return true;
  });

  // 语义去重：题目主干的字符二元组重合度
  const deduped: typeof kept = [];
  for (const q of kept) {
    if (deduped.some((d) => similarity(d.question, q.question) > 0.75)) {
      dropped.push({ question: q.question, reason: "与已有题目重复" });
      continue;
    }
    deduped.push(q);
  }

  const questions: InterviewQuestion[] = deduped.map((q, i) => ({
    ...q,
    id: `q${i + 1}`,
  }));

  // 先按配置取舍，再补全追问——避免为最终被丢弃的题目白花 LLM 调用
  const balanced = rebalanceQuestions(questions, {
    must: jobConfig.baseMustCount,
    optional: jobConfig.baseOptionalCount,
    reserve: jobConfig.baseReserveCount,
    ratio: jobConfig.categoryRatio,
  });
  dropped.push(...balanced.report.dropped);

  // 模型产出的题目可能少于配置期望，如实提示而不是假装已满足
  const expectedTotal =
    jobConfig.baseMustCount +
    jobConfig.baseOptionalCount +
    jobConfig.baseReserveCount +
    candidateConfig.personalizedCount;
  if (balanced.questions.length < expectedTotal) {
    balanced.report.warnings.push(
      `期望 ${expectedTotal} 题，模型实际产出 ${balanced.questions.length} 题。` +
        `差额多因简历中可引用的原文片段不足（无锚点的题会被丢弃）。可补充简历细节后重新生成。`,
    );
  }

  // 二次补全：一次生成 20+ 题时模型会省略 followups，逐题补齐
  const enriched = await enrichQuestions(balanced.questions, {
    levels: candidateConfig.followupLevels ?? 3,
  });

  const coveredDirections = [
    ...new Set(enriched.map((q) => `${q.category} · ${q.dimension || "通用"}`)),
  ].join("\n");

  const reusablePrompt = await askText(
    REUSABLE_PROMPT.system,
    REUSABLE_PROMPT.user({
      jd: params.jd,
      parsed: JSON.stringify(params.parsed, null, 2),
      coveredDirections,
    }),
    0.5,
  );

  return {
    questions: enriched,
    reusablePrompt,
    dropped,
    warnings: balanced.report.warnings,
    distribution: balanced.report.distribution,
    sources: {
      llm: true,
      pool: poolQuestions.length > 0,
      techPoints: techPoints.length,
    },
  };
}

function similarity(a: string, b: string): number {
  const bg = (s: string) => {
    const clean = s.replace(/[^\p{L}\p{N}]/gu, "");
    const set = new Set<string>();
    for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
    return set;
  };
  const A = bg(a);
  const B = bg(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / Math.min(A.size, B.size);
}

/** 校验岗位层配置，返回错误信息数组 */
export function validateJobConfig(cfg: JobQuestionConfig): string[] {
  const errs: string[] = [];
  const total = cfg.baseMustCount + cfg.baseOptionalCount;
  if (total < 10) errs.push("必问 + 选问题量不足 10 题");
  if (cfg.baseMustCount < 3) errs.push("必问题至少 3 道");
  if (cfg.baseMustCount > 15) errs.push("必问题不超过 15 道");

  const ratioSum = Object.values(cfg.categoryRatio).reduce((a, b) => a + b, 0);
  if (ratioSum !== 100) errs.push(`分类占比之和须为 100，当前 ${ratioSum}`);

  for (const [k, v] of Object.entries(cfg.categoryRatio)) {
    if (v === 0) errs.push(`「${k}」占比为 0，该类别将不出题`);
  }

  const internship = cfg.categoryRatio["实习经历"] ?? 0;
  const project = cfg.categoryRatio["项目经历"] ?? 0;
  if (internship + project < 70) {
    errs.push(
      `实习 + 项目占比 ${internship + project}%，已低于 70% 的侧重目标`,
    );
  }
  return errs;
}

export const DEFAULT_JOB_CONFIG: JobQuestionConfig = {
  baseMustCount: 6,
  baseOptionalCount: 14,
  baseReserveCount: 5,
  categoryRatio: {
    实习经历: 35,
    项目经历: 35,
    技术基础: 20,
    软素质: 10,
  },
};

export const DEFAULT_CANDIDATE_CONFIG: CandidateQuestionConfig = {
  personalizedCount: 5,
  personalizedBias: "balanced",
  followupLevels: 3,
};
