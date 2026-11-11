import { askText } from "@/lib/llm/client";

/**
 * PDF 字体缺少 ToUnicode 映射时，pd fjs 会输出装饰性占位符。
 * 同一个占位符在不同上下文可能代表不同的汉字（如 ✁ 处 = 建/的/会），
 * 因此无法用字典映射，只能按上下文由模型推断。
 *
 * 实测来源 c（大厂后端面筋指南）有 3.09% 的字符这样损坏，必须修复，
 * 否则题库里会出现大量语义断裂的题目与答案。
 */
const GLYPHS = ["✁", "✂", "✃", "✄", "✎", "✲", "➓", "➔"];

const GLYPH_RE = new RegExp(`[${GLYPHS.join("")}]`);

export function hasBrokenGlyphs(text: string): boolean {
  return GLYPH_RE.test(text);
}

const SYSTEM = `你是文本修复器。输入文本中的 ${GLYPHS.join(" ")} 等符号是 PDF 字体缺失产生的占位符，
同一个符号在不同位置可能代表不同的汉字。

请根据上下文推断每个占位符应该是什么字，输出修复后的完整文本。

规则：
1. 只替换占位符，其余内容一个字都不要改，不要重排、不要总结、不要补充。
2. 保持原有的换行与段落结构。
3. 只输出修复后的文本，不要任何解释、不要加代码围栏。`;

/**
 * 修复一段文本中的占位符。
 * 失败时返回原文——宁可保留占位符，也不要用错误的字污染题库。
 */
export async function repairGlyphs(text: string): Promise<string> {
  if (!hasBrokenGlyphs(text)) return text;

  const fixed = await askText(SYSTEM, text, 0);

  // 占位符是单字符，「的」「建」也是单字符，替换后长度应基本不变。
  // 关键校验是不得有残留占位符；长度只做宽松兜底。
  if (hasBrokenGlyphs(fixed)) return text;
  if (fixed.length < text.length * 0.75 || fixed.length > text.length * 1.25) {
    return text;
  }
  return fixed.trim();
}

/** 按题目分批修复，控制单次输入长度 */
export function chunkByChars<T extends { question: string; answer: string }>(
  items: T[],
  maxChars = 2500,
): T[][] {
  const chunks: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const it of items) {
    const len = it.question.length + it.answer.length;
    if (cur.length && size + len > maxChars) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(it);
    size += len;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}
