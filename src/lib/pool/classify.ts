import { z } from "zod";
import { askJson } from "@/lib/llm/client";

/**
 * 归类与打标：把切出来的原始题目映射到 question_pool 的字段。
 *
 * question_pool 现有字段：category / tags / question / difficulty / source。
 * 这里额外写入 answers（见 schema 的扩展）与其原始出处，便于面试官展开查看。
 */

export const POOL_CATEGORIES = [
  "Java基础",
  "集合",
  "并发",
  "JVM",
  "Spring",
  "MySQL",
  "Redis",
  "消息队列",
  "分布式",
  "微服务",
  "网络",
  "操作系统",
  "数据结构与算法",
  "设计模式",
  "中间件",
  "项目与架构",
  "其他",
] as const;

export type PoolCategory = (typeof POOL_CATEGORIES)[number];

const classifySchema = z.object({
  items: z.array(
    z.object({
      index: z.number(),
      category: z.string(),
      tags: z.array(z.string()).default([]),
      difficulty: z.number().min(1).max(5).default(3),
      /** 规范化后的题目文本：去掉题号、补全标点，用于去重 */
      title: z.string(),
    }),
  ),
});

const SYSTEM = `你是 Java 后端面试题库的分类器。输入是若干道面试题，请为每道题：

1. category：从以下固定分类中选一个最贴切的（必须原样使用）：
${POOL_CATEGORIES.join(" / ")}
2. tags：2-5 个技术关键词（如 ConcurrentHashMap、AQS、MVCC、B+树、G1）
3. difficulty：1-5，按校招生视角的难度（1=基础常识，5=资深）
4. title：规范化的题目文本——去掉题号前缀、补全标点、不做内容改写

只输出 JSON：{"items":[{"index":0,"category":"...","tags":["..."],"difficulty":3,"title":"..."}]}`;

export type Classified = {
  category: PoolCategory;
  tags: string[];
  difficulty: number;
  title: string;
};

const CATEGORY_SET = new Set<string>(POOL_CATEGORIES);

export async function classifyBatch(
  questions: string[],
): Promise<Classified[]> {
  const list = questions
    .map((q, i) => `${i}. ${q.replace(/\s+/g, " ").slice(0, 150)}`)
    .join("\n");

  const raw = await askJson(
    SYSTEM,
    `共 ${questions.length} 道题：\n${list}`,
    classifySchema,
    { temperature: 0.1, retries: 2 },
  );

  return questions.map((q, i) => {
    const hit = raw.items.find((x) => x.index === i);
    const cat = hit && CATEGORY_SET.has(hit.category)
      ? (hit.category as PoolCategory)
      : "其他";
    return {
      category: cat,
      tags: (hit?.tags ?? []).slice(0, 5),
      difficulty: hit?.difficulty ?? 3,
      title: (hit?.title || q).trim(),
    };
  });
}

/** 批次大小：单个 prompt 不宜过长，否则上游会截断 */
export const CLASSIFY_BATCH_SIZE = 12;
