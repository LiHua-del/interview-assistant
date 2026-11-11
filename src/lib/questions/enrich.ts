import { askJson } from "@/lib/llm/client";
import { z } from "zod";
import type { InterviewQuestion } from "@/lib/db/schema";

const followupSchema = (levels: number) =>
  z.array(
    z.object({
      level: z
        .union([z.number(), z.string()])
        .transform((v) => {
          const n = typeof v === "number" ? v : Number(v);
          return Number.isFinite(n) && n >= 1 && n <= levels ? n : 1;
        })
        .pipe(z.number().min(1).max(levels))
        .transform((n) => n as 1 | 2 | 3 | 4 | 5),
      trigger: z.string().default(""),
      question: z.string().min(1),
    }),
  );

const enrichResultSchema = (levels: number) =>
  z.object({
    followups: followupSchema(levels),
    expectedPoints: z.array(z.string()).default([]),
    goodSignals: z.array(z.string()).default([]),
    redFlags: z.array(z.string()).default([]),
  });

const ENRICH_SYSTEM = (levels: number, scene: string, tech: string, depth: string) => `你是资深技术面试官。给定一道已确定的面试题，补齐 ${levels} 层追问与评分信号。

## 这道题的背景
- 场景：${scene || "未标注"}
- 技术点：${tech || "未标注"}
- 简历对它的描述程度：${depth || "未标注"}

## 追问的递进逻辑

追问不是把同一个问题换个问法，而是沿着"这个技术点他到底掌握到哪一层"逐层往下压：

**第 1 层 · 落地细节**：问具体做了什么——方案、参数、命令、数据结构。
答不出这层，基本可以判定没真做过。

**第 2 层 · 选型与权衡**：问为什么这么做——备选方案是什么、为什么不选、
当时受什么约束（时间、人力、存量系统、团队技术栈）。

**第 3 层 · 边界与故障**：问什么情况下会出问题——临界值、失败表现、
线上出过什么故障、怎么发现的、怎么兜底。

**第 4 层及以后 · 演进与迁移**：问如果重做会怎么改、业务涨十倍怎么办、
换一个技术栈怎么迁移、这个方案的长期代价是什么。

每一层的 trigger 必须写清楚"候选人答到什么程度才追问这一句"，
让面试官能判断该不该问，而不是按顺序念完。

## 评分信号

- expectedPoints：评分要点，${Math.max(3, levels)}-${levels + 3} 条，是"要点"不是完整范文
- goodSignals：真做过的人才会说出的具体细节（如具体的命令、参数、报错信息、同事角色）
- redFlags：编造者容易暴露的特征（如只会背结论、数字前后矛盾、说不出任何失败经历）

## 输出要求

- 每层追问控制在 120 字以内，只问一个核心点，不要在一句里塞多个问题
- trigger 控制在 60 字以内
- 总输出不要超过 2000 字，务必输出完整的 JSON

只输出 JSON 对象：
{
  "followups": [{"level":1,"trigger":"...","question":"..."}, ...],
  "expectedPoints": ["..."],
  "goodSignals": ["..."],
  "redFlags": ["..."]
}`;


type Followup = InterviewQuestion["followups"][number];

/**
 * 模型常返回重复或跳级的 level，按出现顺序重新编号，
 * 保证前端呈现的层级连续。
 */
function normalizeFollowups(raw: Followup[], levels: number): Followup[] {
  const sorted = [...raw].sort((a, b) => a.level - b.level);
  const seen = new Set<number>();
  const unique: Followup[] = [];
  for (const f of sorted) {
    if (seen.has(f.level)) continue;
    seen.add(f.level);
    unique.push(f);
  }
  return unique
    .slice(0, levels)
    .map((f, i) => ({ ...f, level: (i + 1) as 1 | 2 | 3 | 4 | 5 }));
}

/** 并发受限的 map */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 补齐追问与评分信号。
 * 一次生成 20+ 题时模型会省略 followups，故拆成逐题补全的第二次调用。
 * 并发保持较低：本机 LLM 服务对并发请求不友好，太高会导致大量静默失败。
 */
export async function enrichQuestions(
  questions: InterviewQuestion[],
  opts: { levels?: number; concurrency?: number } = {},
): Promise<InterviewQuestion[]> {
  const { levels = 3, concurrency = 2 } = opts;

  return mapLimit(questions, concurrency, async (q) => {
    // 追问层数已达标的不再重复调用
    if (q.followups.length >= levels && q.expectedPoints.length > 0) return q;

    try {
      const extra = await askJson(
        ENRICH_SYSTEM(levels, q.scene, q.tech, q.depth),
        `题目：${q.question}
分类：${q.category}
考察点：${q.dimension || "未指定"}
简历依据：${q.resumeAnchor || "（通用题，无简历锚点）"}`,
        enrichResultSchema(levels),
        { temperature: 0.4, retries: 2 },
      );

      const followups = normalizeFollowups(extra.followups, levels);

      return {
        ...q,
        followups,
        expectedPoints: extra.expectedPoints.length
          ? extra.expectedPoints
          : q.expectedPoints,
        goodSignals: extra.goodSignals.length ? extra.goodSignals : q.goodSignals,
        redFlags: extra.redFlags.length ? extra.redFlags : q.redFlags,
      };
    } catch (err) {
      // 单题补全失败不影响整份题单，但要留下痕迹便于排查
      console.error(
        `[enrich] 题目补全失败 id=${q.id}:`,
        err instanceof Error ? err.message : err,
      );
      return q;
    }
  });
}
