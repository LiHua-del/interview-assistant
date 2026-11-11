import type { PoolCategory } from "@/lib/pool/classify";

export type PoolItem = {
  question: string;
  answer: string;
  category: PoolCategory;
  tags: string[];
  difficulty: number;
  sourceFile: string;
  sourceKey: string;
};

export type DedupResult = {
  /** 保留下来的题目，duplicates 表示合并了多少条 */
  kept: (PoolItem & { duplicates: number })[];
  removed: number;
};

function normalize(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/[，。、；：""''？！…—\-（）()【】《》,.;:?!'"()\[\]]/g, "")
    .toLowerCase();
}

function bigrams(s: string): Set<string> {
  const clean = normalize(s);
  const set = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
  return set;
}

/** 二元组 Jaccard 系数 */
function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const g of small) if (large.has(g)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * 包含度：短题的字符二元组有多少比例出现在长题里。
 *
 * 中文题目常见"同一问题换了问法"的情况，例如
 *   "MySQL 中有哪几种锁？" vs "MySQL 中有哪几种锁，列举一下？"
 * Jaccard 会因多出的"列举一下"被稀释到 0.71，但两者其实是同一道题。
 * 包含度对这种增补式改写更敏感。
 */
function containment(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const g of small) if (large.has(g)) inter++;
  return inter / small.size;
}

const DUP_JACCARD = 0.62;
const DUP_CONTAINMENT = 0.85;

function isDuplicate(a: Set<string>, b: Set<string>): boolean {
  return similarity(a, b) >= DUP_JACCARD || containment(a, b) >= DUP_CONTAINMENT;
}

/**
 * 去重：题目语义相似的合并为一条。
 *
 * 四份 PDF 内容高度重叠（同一道题常有 2-4 个版本），
 * 保留答案最长的那条，并累加 duplicates 作为"高频"信号。
 *
 * 分桶优化：先按首字分组，只与同桶比较，避免 1800² 的暴力两两比较。
 */
export function dedupe(items: PoolItem[]): DedupResult {
  // 先按规范化题目长度降序，长题目通常信息更全，优先保留
  const sorted = [...items].sort(
    (a, b) => b.answer.length + b.question.length - (a.answer.length + a.question.length),
  );

  const buckets = new Map<string, { item: PoolItem; gram: Set<string>; count: number }[]>();
  const kept: (PoolItem & { duplicates: number })[] = [];
  let removed = 0;

  for (const it of sorted) {
    const gram = bigrams(it.question);
    const key = normalize(it.question).slice(0, 2);

    let merged = false;
    for (const bucket of [key, "**"]) {
      const list = buckets.get(bucket);
      if (!list) continue;
      for (const entry of list) {
        if (isDuplicate(gram, entry.gram)) {
          entry.count++;
          removed++;
          merged = true;
          break;
        }
      }
      if (merged) break;
    }

    if (!merged) {
      const entry = { item: it, gram, count: 0 };
      kept.push({ ...it, duplicates: 0 });
      const list = buckets.get(key) ?? [];
      list.push(entry);
      buckets.set(key, list);
    }
  }

  // 把合并计数写回
  for (const list of buckets.values()) {
    for (const e of list) {
      const target = kept.find((k) => k.question === e.item.question);
      if (target) target.duplicates = e.count;
    }
  }

  return { kept, removed };
}
