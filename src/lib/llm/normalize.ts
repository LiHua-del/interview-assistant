/**
 * 模型输出的字段名并不稳定（share/ratio/percent、excerpt/quote 等）。
 * 与其在 schema 上逐字段猜测，不如在解析前做一次别名归一。
 */

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 从对象里按候选键名取第一个存在的值 */
function pick(o: Json, keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.\-]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

/** 把 ratio/percent/占比 之类的值统一成 0-1 */
function ratio(v: unknown): number | undefined {
  const n = num(v);
  if (n === undefined) return undefined;
  return n > 1 ? n / 100 : n;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function normalizeCandidateReview(input: unknown): unknown {
  if (!isObj(input)) return input;
  const metrics = isObj(input.metrics) ? input.metrics : {};
  const coverage = isObj(metrics.coverage) ? metrics.coverage : {};
  const hitRate = isObj(metrics.hitRate) ? metrics.hitRate : {};

  const dims = arr(metrics.dimensions).map((d) => {
    const o = isObj(d) ? d : {};
    return {
      key: str(pick(o, ["key", "id", "dimension"])) ?? "",
      name: str(pick(o, ["name", "label", "title"])) ?? "",
      score: num(pick(o, ["score", "value", "rating"])) ?? 3,
      weight: num(pick(o, ["weight", "ratio", "percent"])) ?? 0,
    };
  });

  return {
    ...input,
    metrics: {
      coverage: {
        asked: num(pick(coverage, ["asked", "askedCount", "hit"])) ?? 0,
        total: num(pick(coverage, ["total", "totalCount"])) ?? 0,
        ratio: ratio(pick(coverage, ["ratio", "rate", "percent"])) ?? 0,
      },
      hitRate: {
        hit: num(pick(hitRate, ["hit", "hitCount", "matched", "hitQuestions"])) ?? 0,
        answered:
          num(
            pick(hitRate, [
              "answered",
              "answeredCount",
              "answeredQuestions",
              "totalAnswered",
              "attempted",
            ]),
          ) ?? 0,
        ratio: ratio(pick(hitRate, ["ratio", "rate", "percent"])) ?? 0,
      },
      dimensions: dims,
      weightedTotal:
        num(pick(metrics, ["weightedTotal", "total", "overall"])) ?? 0,
    },
    verdict: str(pick(input, ["verdict", "conclusion", "recommendation"])) ?? "待定",
    verdictReason:
      str(pick(input, ["verdictReason", "reason", "rationale"])) ?? "",
    strengths: arr(pick(input, ["strengths", "highlights"])).map((s) => {
      const o = isObj(s) ? s : {};
      return {
        point: str(pick(o, ["point", "text", "title", "content"])) ?? "",
        evidence: str(pick(o, ["evidence", "quote", "excerpt", "source"])) ?? "",
      };
    }),
    weaknesses: arr(pick(input, ["weaknesses", "gaps", "shortcomings"])).map(
      (s) => {
        const o = isObj(s) ? s : {};
        return {
          point: str(pick(o, ["point", "text", "title", "content"])) ?? "",
          evidence: str(pick(o, ["evidence", "quote", "excerpt", "source"])) ?? "",
        };
      },
    ),
    attribution: arr(pick(input, ["attribution", "causes"])).map((a) => {
      const o = isObj(a) ? a : {};
      return {
        topic:
          str(
            pick(o, [
              "topic",
              "subject",
              "item",
              "dimension",
              "aspect",
              "area",
              "name",
            ]),
          ) ?? "",
        cause: str(pick(o, ["cause", "type", "reason", "category"])) ?? "真不会",
        evidence:
          str(pick(o, ["evidence", "quote", "excerpt", "source"])) ?? "",
      };
    }),
    digDeeper: arr(pick(input, ["digDeeper", "followups", "deepen"])).map(
      (d) => {
        const o = isObj(d) ? d : {};
        return {
          topic: str(pick(o, ["topic", "point", "item"])) ?? "",
          suggestion: str(pick(o, ["suggestion", "advice", "detail"])) ?? "",
        };
      },
    ),
  };
}

export function normalizeInterviewerReview(input: unknown): unknown {
  if (!isObj(input)) return input;
  return {
    ...input,
    mustHitRate: ratio(pick(input, ["mustHitRate", "mustHit", "coverage"])) ?? 0,
    avgFollowupDepth:
      num(pick(input, ["avgFollowupDepth", "followupDepth", "depth"])) ?? 0,
    offTopicRatio: ratio(pick(input, ["offTopicRatio", "offTopic", "offtopic"])) ?? 0,
    candidateTalkRatio:
      ratio(
        pick(input, [
          "candidateTalkRatio",
          "candidateRatio",
          "talkRatio",
          "candidateShare",
        ]),
      ) ?? 0,
    leadingQuestions: arr(
      pick(input, ["leadingQuestions", "leading"]),
    ).map((l) => {
      const o = isObj(l) ? l : {};
      return {
        excerpt: str(pick(o, ["excerpt", "quote", "text", "question"])) ?? "",
        reason: str(pick(o, ["reason", "why", "explanation"])) ?? "",
      };
    }),
    timeDistribution: arr(pick(input, ["timeDistribution", "time", "topics"])).map(
      (t) => {
        const o = isObj(t) ? t : {};
        return {
          topic: str(pick(o, ["topic", "name", "item"])) ?? "",
          share:
            ratio(pick(o, ["share", "ratio", "percent", "value", "percentage"])) ??
            0,
        };
      },
    ),
    complianceRedFlags: arr(
      pick(input, ["complianceRedFlags", "compliance", "redFlags"]),
    ).map((f) => {
      const o = isObj(f) ? f : {};
      return {
        excerpt: str(pick(o, ["excerpt", "quote", "text", "question"])) ?? "",
        category: str(pick(o, ["category", "type", "topic"])) ?? "不合规提问",
      };
    }),
  };
}
