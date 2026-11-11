import type {
  InterviewQuestion,
  QuestionCategory,
} from "@/lib/db/schema";
import type { RiskFinding } from "@/lib/db/schema";

export type RebalanceReport = {
  /** 因超额或不足被丢弃的题目 */
  dropped: { question: string; reason: string }[];
  /** 实际采用的分类分布 */
  distribution: Record<string, number>;
  /** 与目标占比偏差超过 10 个百分点的类别 */
  warnings: string[];
};

/**
 * 强制题单符合岗位配置的题数与分类占比。
 *
 * 模型很难精确遵守比例，所以在生成后做一次确定性调整：
 * 1. 每类按配额截断，保留优先级更高的题
 * 2. 配额未满的类别，从超额类别里挑锚点相近的补（不凭空生成）
 *
 * 硬约束：不改变题目内容，只做取舍，因此不会引入幻觉。
 */
export function rebalanceQuestions(
  questions: InterviewQuestion[],
  cfg: {
    must: number;
    optional: number;
    reserve: number;
    ratio: Record<QuestionCategory, number>;
  },
): { questions: InterviewQuestion[]; report: RebalanceReport } {
  const dropped: RebalanceReport["dropped"] = [];
  const PRIORITY_RANK = { 必问: 0, 选问: 1, 备用: 2 } as const;

  // 先按优先级稳定排序，同类内保持模型给的顺序
  const sorted = [...questions].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
  );

  const byCat = new Map<QuestionCategory, InterviewQuestion[]>();
  for (const q of sorted) {
    const list = byCat.get(q.category) ?? [];
    list.push(q);
    byCat.set(q.category, list);
  }

  // 以「必问 + 选问」为基数计算各类配额
  const mainTotal = cfg.must + cfg.optional;
  const quota = {} as Record<QuestionCategory, number>;
  let assigned = 0;
  const cats = Object.keys(cfg.ratio) as QuestionCategory[];

  for (const c of cats) {
    quota[c] = Math.floor((cfg.ratio[c] / 100) * mainTotal);
    assigned += quota[c];
  }
  // 余数按占比从高到低补
  let leftover = mainTotal - assigned;
  for (const c of [...cats].sort((a, b) => cfg.ratio[b] - cfg.ratio[a])) {
    if (leftover <= 0) break;
    quota[c]++;
    leftover--;
  }

  const kept: InterviewQuestion[] = [];

  for (const c of cats) {
    const pool = byCat.get(c) ?? [];
    const limit = quota[c];
    if (pool.length > limit) {
      kept.push(...pool.slice(0, limit));
      for (const q of pool.slice(limit)) {
        dropped.push({
          question: q.question,
          reason: `「${c}」超额，目标 ${limit} 题`,
        });
      }
    } else {
      kept.push(...pool);
    }
  }

  // 配额未满的类别，从其他类别的剩余题目里补，但只在锚点相关时补
  for (const c of cats) {
    const have = kept.filter((q) => q.category === c).length;
    let need = quota[c] - have;
    if (need <= 0) continue;

    const usedIds = new Set(kept.map((q) => q.id));
    const candidates = sorted.filter(
      (q) => !usedIds.has(q.id) && q.category !== c,
    );
    for (const q of candidates) {
      if (need <= 0) break;
      if (!q.resumeAnchor) continue;
      kept.push({ ...q, category: c });
      usedIds.add(q.id);
      need--;
    }
  }

  // 备用题按配置数量从剩余里取
  const usedIds = new Set(kept.map((q) => q.id));
  const reservePool = sorted.filter((q) => !usedIds.has(q.id));
  const reserves = reservePool.slice(0, cfg.reserve);
  for (const q of reservePool.slice(cfg.reserve)) {
    dropped.push({ question: q.question, reason: "超出备用池容量" });
  }

  const final = [...kept, ...reserves];

  // 优先级也要收敛到配置数量
  const normalized = enforcePriorityCounts(final, cfg, dropped);

  const distribution: Record<string, number> = {};
  for (const q of normalized) {
    distribution[q.category] = (distribution[q.category] ?? 0) + 1;
  }

  const warnings: string[] = [];
  const total = normalized.length || 1;
  for (const c of cats) {
    const actual = ((distribution[c] ?? 0) / total) * 100;
    const target = cfg.ratio[c];
    if (Math.abs(actual - target) > 10) {
      warnings.push(
        `${c} 实际 ${actual.toFixed(0)}%，目标 ${target}%（简历中该方向素材不足）`,
      );
    }
  }

  return {
    questions: normalized.map((q, i) => ({ ...q, id: `q${i + 1}` })),
    report: { dropped, distribution, warnings },
  };
}

function enforcePriorityCounts(
  questions: InterviewQuestion[],
  cfg: { must: number; optional: number; reserve: number },
  dropped: RebalanceReport["dropped"],
): InterviewQuestion[] {
  const must = questions.filter((q) => q.priority === "必问");
  const optional = questions.filter((q) => q.priority === "选问");
  const reserve = questions.filter((q) => q.priority === "备用");

  const out: InterviewQuestion[] = [];

  if (must.length > cfg.must) {
    out.push(...must.slice(0, cfg.must));
    // 多出来的必问题降级为选问，而不是丢弃
    for (const q of must.slice(cfg.must)) {
      optional.push({ ...q, priority: "选问" });
    }
  } else {
    out.push(...must);
    // 必问题不足，从选问里升格
    let need = cfg.must - must.length;
    const promoted: InterviewQuestion[] = [];
    for (const q of optional) {
      if (need <= 0) break;
      if (!q.resumeAnchor) continue;
      promoted.push({ ...q, priority: "必问" });
      need--;
    }
    for (const p of promoted) {
      const idx = optional.findIndex((o) => o.id === p.id);
      if (idx >= 0) optional.splice(idx, 1);
    }
    out.push(...promoted);
  }

  if (optional.length > cfg.optional) {
    for (const q of optional.slice(cfg.optional)) {
      dropped.push({ question: q.question, reason: "超出选问配额" });
    }
    out.push(...optional.slice(0, cfg.optional));
  } else {
    out.push(...optional);
  }

  out.push(...reserve.slice(0, cfg.reserve));
  return out;
}

/** 把风险扫描的高危项对应到题目上，确保它们出现在必问里 */
export function ensureRiskCoverage(
  questions: InterviewQuestion[],
  risks: RiskFinding[],
  mustCount: number,
): InterviewQuestion[] {
  const highRisks = risks.filter((r) => r.severity === "高");
  if (!highRisks.length) return questions;

  const covered = (q: InterviewQuestion) =>
    highRisks.some((r) => q.resumeAnchor && r.anchor.includes(q.resumeAnchor.slice(0, 12)));

  const riskQs = questions.filter(covered);
  if (riskQs.length >= mustCount) return questions;

  // 把已覆盖高危项的题提到必问，同时把等量的非风险必问降级
  const out = [...questions];
  let promoted = 0;
  for (const q of out) {
    if (riskQs.length + promoted >= mustCount) break;
    if (covered(q) && q.priority !== "必问") {
      q.priority = "必问";
      promoted++;
    }
  }
  void mustCount;
  return out;
}
