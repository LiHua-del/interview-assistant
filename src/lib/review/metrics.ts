import type {
  InterviewQuestion,
  RubricDimension,
} from "@/lib/db/schema";

/**
 * 覆盖率与命中率这类可确定性计算的指标，不交给模型。
 * 模型只负责需要判断力的部分（维度评分、归因、提问质量）。
 */

/** 归一化：去空白、去标点，便于中文模糊比对 */
function norm(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/[，。、；：""''？！…—\-（）()【】《》,.;:?!'"()\[\]]/g, "")
    .toLowerCase();
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  const clean = norm(s);
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
  return set;
}

/** 题目是否在纪要中被问到：用字符二元组重合度衡量 */
function questionAsked(q: InterviewQuestion, transcript: string): boolean {
  const qGram = bigrams(q.question);
  if (qGram.size === 0) return false;

  // 在纪要里滑动窗口找最相似片段
  const tNorm = norm(transcript);
  const qLen = norm(q.question).length;
  const win = Math.max(8, Math.min(qLen, 40));

  let best = 0;
  for (let i = 0; i + win <= tNorm.length; i += 4) {
    const chunk = bigrams(tNorm.slice(i, i + win));
    if (!chunk.size) continue;
    let inter = 0;
    for (const g of qGram) if (chunk.has(g)) inter++;
    const score = inter / Math.min(qGram.size, chunk.size);
    if (score > best) best = score;
    if (best >= 0.5) break;
  }
  return best >= 0.42;
}

export function computeCoverage(
  questions: InterviewQuestion[],
  transcript: string,
): { asked: number; total: number; ratio: number } {
  const must = questions.filter((q) => q.priority === "必问");
  const total = must.length;
  const asked = must.filter((q) => questionAsked(q, transcript)).length;
  return { asked, total, ratio: total ? round2(asked / total) : 0 };
}

/**
 * 答题命中率：以"有效回答题数"为分母。
 * 在纪要里能定位到候选人的实质回答（非"不清楚/忘了"）才算有效。
 */
export function computeHitRate(
  questions: InterviewQuestion[],
  transcript: string,
): { hit: number; answered: number; ratio: number } {
  const ASKED = questions.filter((q) => questionAsked(q, transcript));
  if (!ASKED.length) return { hit: 0, answered: 0, ratio: 0 };

  let answered = 0;
  let hit = 0;
  // 多个题目可能匹配到同一段问答，避免重复计分
  const usedLines = new Set<string>();

  for (const q of ASKED) {
    const { excerpt, lineKey } = extractCandidateAnswer(q, transcript);
    if (!excerpt) continue;
    if (usedLines.has(lineKey)) continue;
    usedLines.add(lineKey);
    if (isNonAnswer(excerpt)) continue;
    answered++;

    const points = q.expectedPoints.length
      ? q.expectedPoints
      : [q.dimension].filter(Boolean);
    const hitCount = points.filter((p) => pointCovered(p, excerpt)).length;
    if (points.length && hitCount / points.length >= 0.3) hit++;
  }

  return { hit, answered, ratio: answered ? round2(hit / answered) : 0 };
}

/** 取题目之后最近一段候选人发言 */
function extractCandidateAnswer(
  q: InterviewQuestion,
  transcript: string,
): { excerpt: string | null; lineKey: string } {
  const qGram = bigrams(q.question);
  const lines = transcript.split(/\n+/);
  let bestIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < lines.length; i++) {
    const lb = bigrams(lines[i]);
    if (!lb.size) continue;
    let inter = 0;
    for (const g of qGram) if (lb.has(g)) inter++;
    const score = inter / Math.min(qGram.size, lb.size || 1);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx === -1 || bestScore < 0.3) {
    return { excerpt: null, lineKey: "" };
  }

  // 往后找候选人发言
  for (let i = bestIdx + 1; i < Math.min(bestIdx + 6, lines.length); i++) {
    const line = lines[i];
    if (/^(候选人|面试者|应聘者|C)[：:]/.test(line.trim())) {
      return {
        excerpt: line.replace(/^[^：:]*[：:]/, "").trim(),
        lineKey: `L${i}`,
      };
    }
  }
  return { excerpt: null, lineKey: "" };
}

const NON_ANSWER = /不(太)?清楚|不(太)?记得|忘了|没(有)?参与|不了解|不确定|不知道|应该是吧|大概吧/;

function isNonAnswer(text: string): boolean {
  // 短回答且含搪塞词 → 视为无效回答
  if (text.length < 12) return true;
  const hits = text.match(new RegExp(NON_ANSWER.source, "g"))?.length ?? 0;
  return hits > 0 && hits / Math.max(text.length / 30, 1) > 0.4;
}

/** 要点是否被回答覆盖：取要点中的关键词集合 */
function pointCovered(point: string, answer: string): boolean {
  const KEYWORD_SPLIT = /[、，,/]|\s+和\s+|\s*与\s*/;
  const keys = point
    .split(KEYWORD_SPLIT)
    .map((s) => norm(s))
    .filter((s) => s.length >= 2);
  if (!keys.length) return false;
  const aNorm = norm(answer);
  return keys.some((k) => aNorm.includes(k));
}

/** 维度加权总分，由本地按 Rubric 权重算，避免模型算错 */
export function computeWeightedTotal(
  dimensions: { key: string; score: number; weight: number }[],
  rubric: RubricDimension[],
): number {
  const weightOf = new Map(rubric.map((r) => [r.key, r.weight]));
  let total = 0;
  let usedWeight = 0;
  for (const d of dimensions) {
    const w = weightOf.get(d.key) ?? d.weight ?? 0;
    total += d.score * w;
    usedWeight += w;
  }
  if (!usedWeight) return 0;
  return round2(total / usedWeight);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
