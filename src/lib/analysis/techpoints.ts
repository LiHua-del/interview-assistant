import { z } from "zod";
import { askJson } from "@/lib/llm/client";
import type { ParsedResume, RiskFinding } from "@/lib/db/schema";

/**
 * 技术点提取：把简历里的技术名词还原成「在哪个场景里、用来做什么」。
 *
 * 这是出题的主轴。面试官真正要验的不是"你知不知道 Kafka"，
 * 而是"你在那个项目里用 Kafka 做了什么、为什么这么选、出了问题怎么解决"。
 * 只拿到技术名词列表是不够的，必须带上场景与角色。
 */

export const techPointSchema = z.object({
  points: z.array(
    z.object({
      /** 技术名，如 Kafka、Redis、MySQL 索引 */
      tech: z.string().min(1),
      /** 出现在哪段经历：实习/项目名 */
      scene: z.string().default(""),
      /** 简历原文中该技术出现的片段，必须可检索 */
      anchor: z.string().min(1),
      /** 简历里声称用它做了什么 */
      usage: z.string().default(""),
      /** 简历对该技术的描述详细程度 */
      depth: z
        .string()
        .default("未标注")
        .transform((v) =>
          v.includes("量化")
            ? "有量化结果"
            : v.includes("实现") || v.includes("细节")
              ? "有实现细节"
              : v.includes("方案") || v.includes("描述")
                ? "有方案描述"
                : "一句话带过",
        ),
      /** 候选人在这段经历中的角色 */
      role: z
        .string()
        .default("未说明")
        .transform((v) =>
          v.includes("主导") || v.includes("负责")
            ? "主导"
            : v.includes("配合") || v.includes("协助")
              ? "配合"
              : v.includes("参与")
                ? "参与"
                : "未说明",
        ),
      /** 该技术点值得深挖的方向（1-3 条） */
      probeAngles: z.array(z.string()).default([]),
    }),
  ),
});

/** 模型可能用 points / techPoints / items 等不同键名 */
export function normalizeTechPoints(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;

  const pickList = (o: Record<string, unknown>): unknown[] | null => {
    for (const k of [
      "points",
      "techPoints",
      "tech_points",
      "items",
      "list",
      "technologies",
    ]) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
    return null;
  };

  const list = Array.isArray(raw) ? raw : pickList(raw as Record<string, unknown>);
  if (!list) return raw;

  // 条目内字段名同样不稳定：name/technology 代替 tech，evidence/source 代替 anchor
  const items = list.map((item) => {
    if (typeof item !== "object" || item === null) return item;
    const o = item as Record<string, unknown>;
    const first = (...keys: string[]) => {
      for (const k of keys) {
        if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
      }
      return undefined;
    };

    return {
      tech: first("tech", "name", "technology", "techName", "关键词") ?? "",
      scene: first("scene", "context", "project", "场景", "出处") ?? "",
      anchor: first("anchor", "evidence", "source", "quote", "原文", "snippet") ?? "",
      usage: first("usage", "purpose", "usageDescription", "用途", "描述") ?? "",
      depth: first("depth", "detailLevel", "深度") ?? "一句话带过",
      role: first("role", "角色") ?? "未说明",
      probeAngles: Array.isArray(o.probeAngles)
        ? o.probeAngles
        : Array.isArray(o.angles)
          ? o.angles
          : Array.isArray(o.probes)
            ? o.probes
            : [],
    };
  });

  return { points: items };
}

export type TechPoint = z.infer<typeof techPointSchema>["points"][number];

const SYSTEM = `你是资深技术面试官，正在为一次深度面试做功课。

任务：从简历中提取候选人**实际写到的技术点**，并还原每个技术点的使用场景。

要求：
1. **只提取简历里真实出现的**。不要根据岗位 JD 补充候选人没写过的技术。
2. 每个技术点必须带 anchor —— 简历原文中**连续的一段文字**，照抄不改写。
   找不到可照抄的原文就不要输出这一条。
3. scene 写清楚技术出现在哪段经历（公司+岗位，或项目名）。
4. usage 写简历声称用它解决了什么问题，不要你自己推断。
5. depth 按简历的描述详细程度判定：
   - 一句话带过：只提了名字，没有任何说明
   - 有方案描述：说了做了什么，但没讲怎么做
   - 有实现细节：讲了具体做法、参数、结构
   - 有量化结果：带数字指标
6. role 按简历措辞判断：主导 / 参与 / 配合 / 未说明
7. probeAngles 给出 1-3 个值得深挖的方向。要具体到这个技术点，
   比如"消息积压时的消费端削峰策略"而不是"深入理解 Kafka"。
8. 优先提取实习与项目经历里的技术点，技能栏单独列出的技术
   若在正文中没有任何使用记录，也要提取，depth 标为"一句话带过"——
   这类是重点验真对象。`;

export async function extractTechPoints(
  parsed: ParsedResume,
  rawText: string,
  risks: RiskFinding[],
): Promise<TechPoint[]> {
  const result = await askJson(
    SYSTEM,
    `简历结构化结果：
<parsed>
${JSON.stringify(parsed, null, 2)}
</parsed>

简历原文（用于照抄 anchor）：
<raw>
${rawText.slice(0, 12000)}
</raw>

已发现的可疑点（提取技术点时重点关注这些相关部分）：
<risks>
${JSON.stringify(risks, null, 2)}
</risks>`,
    techPointSchema,
    { temperature: 0.2, retries: 2, preprocess: normalizeTechPoints },
  );

  // 与题目锚点同一套防幻觉规则：引用不到原文的一律丢弃
  const norm = (s: string) =>
    s.replace(/\s+/g, "").replace(/[，。、；：""''？！…—\-（）()【】《》,.;:?!'"()\[\]]/g, "");
  const haystack = norm(rawText);

  return result.points.filter((p) => {
    const a = norm(p.anchor);
    return a.length >= 4 && haystack.includes(a);
  });
}

/** 按场景聚合，便于出题时按经历成组提问 */
export function groupByScene(points: TechPoint[]): Map<string, TechPoint[]> {
  const map = new Map<string, TechPoint[]>();
  for (const p of points) {
    const key = p.scene || "未标注场景";
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return map;
}
