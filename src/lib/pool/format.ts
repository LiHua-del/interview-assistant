/**
 * 题库答案的排版清洗。
 *
 * PDF 抽取出来的答案有三类纯排版噪声，与内容无关：
 *  1. 版面硬换行：一行没排满就换行，把一句话切成两段（78% 的答案都有）
 *  2. 中文之间的多余空格：`考虑以下情况 ： 我们有` —— PDF 字距被抽成空格
 *  3. 残留的章节/题号行：`13.14.1` 单独成行
 *
 * 这些都是确定性可判定的，用规则修复即可，不需要模型，也不会引入事实错误。
 */

const CJK = /[一-鿿]/;
const CJK_PUNCT = /[，。、；：？！（）「」『』《》…—]/;

/** 中文标点（用于判断句末，决定是否真换行） */
const SENTENCE_END = /[。！？；：]$/;

/**
 * PDF 里 Powerpoint/Symbol 字体的项目符号会落到私用区（U+F0B7 等），
 * 视觉上是「•」但字符不可打印。统一换成可见的项目符号。
 */
export function normalizeBullets(text: string): string {
  return text.replace(/[-]/g, "•");
}

/**
 * 清理中文之间的多余空格。
 * 只处理「中文 + 空格 + 中文/中文标点」这种 PDF 字距残留，
 * 保留英文单词间的正常空格。
 */
export function normalizeSpaces(text: string): string {
  let t = text;
  let prev = "";
  // 反复替换直到稳定，处理 "中 文 字" 这种连续多空格
  while (prev !== t) {
    prev = t;
    t = t
      // 中文 + 空格 + 中文
      .replace(/([一-鿿])[ \t]+(?=[一-鿿])/g, "$1")
      // 中文 + 空格 + 中文标点
      .replace(/([一-鿿])[ \t]+(?=[，。、；：？！（）「」『』《》…—])/g, "$1")
      // 中文标点 + 空格 + 中文
      .replace(/([，。、；：？！（）「」『』《》…—])[ \t]+(?=[一-鿿])/g, "$1");
  }
  return t;
}

/** 去掉单独成行的章节号/题号，如 "13.14.1"、"4.1.5." */
export function stripResidualNumbers(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      // 整行只有一个多级编号
      if (/^\d{1,2}(?:\.\d{1,2}){1,3}\.?$/.test(t)) return false;
      return true;
    })
    .map((line) => {
      // 行首的多级章节号（如 "13.14.2 monitor 监视器"）去掉编号保留标题
      const m = line.match(/^(\s*)\d{1,2}(?:\.\d{1,2}){1,3}\.?\s+(\S.*)$/);
      if (m && m[2].length >= 2) return m[1] + m[2];
      return line;
    })
    .join("\n");
}

/**
 * 合并版面硬换行。
 *
 * 判定规则（满足全部条件才合并）：
 *  - 上一行不以句末标点结尾（不是完整句子）
 *  - 上一行最后是中文或中文标点
 *  - 下一行第一个字符是中文（不是代码、不是编号列表）
 *  - 下一行不是新段落的典型开头（数字编号、- 、· 等）
 *  - 上一行长度 >= 12（太短的多是标题，如"ThreadLocal 原理"）
 */
export function mergeHardWraps(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      out.push("");
      continue;
    }

    const prev = out[out.length - 1];
    const canMerge =
      prev !== undefined &&
      prev !== "" &&
      prev.length >= 12 &&
      !SENTENCE_END.test(prev) &&
      (CJK.test(prev.slice(-1)) || CJK_PUNCT.test(prev.slice(-1))) &&
      CJK.test(line[0]) &&
      // 下一行不是列表项/编号/代码
      !/^(\d+[.、)]|[-·•*]|[（(]\d+[)）])\s*/.test(line) &&
      // 上一行不是代码
      !/[{};]\s*$/.test(prev) &&
      // 下一行不像代码
      !/^(public|private|protected|static|class|interface|import|package|@|\/\/|\/\*)/.test(
        line,
      );

    if (canMerge) {
      // 中文之间合并时不加空格；涉及英文时补一个空格
      const lastCh = prev.slice(-1);
      const firstCh = line[0];
      const needSpace =
        !CJK.test(lastCh) && !CJK_PUNCT.test(lastCh) && !CJK_PUNCT.test(firstCh);
      out[out.length - 1] = prev + (needSpace ? " " : "") + line;
    } else {
      out.push(line);
    }
  }

  return out.join("\n");
}

/** 完整清洗：去编号 → 合并换行 → 规范空格 → 收敛空行 */
export function cleanAnswer(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n");
  t = normalizeBullets(t);
  t = stripResidualNumbers(t);
  // 合并换行跑两遍，处理三行连成一句的情况
  t = mergeHardWraps(t);
  t = mergeHardWraps(t);
  t = normalizeSpaces(t);
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

// ---------- 渲染结构识别 ----------

export type AnswerBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; text: string };

const CODE_START =
  /^(public|private|protected|static|final|class|interface|enum|abstract|package|import|@\w|\/\/|\/\*|\*\/|\}|\{|#include|SELECT\s+.*\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(TABLE|INDEX|DATABASE)|ALTER\s+TABLE)\b/i;

/** 行尾是分号或大括号，或行首是注释 —— 但 SQL 片段常被误判，需要额外排除 */
const CODE_HINT = /[{};]\s*$|^\s*\/\/|^\s*\*/;

/** URL 或 "// 域名" 形式出现在正文里，不是注释 */
const URL_LIKE = /^\s*\/\/\s*[a-zA-Z0-9.:\-]|https?:\/\//;

/** 小写开头的 select/insert 等常是行内 SQL 举例，不是代码块 */
const SQL_EXAMPLE = /^\s*select\s|^\s*insert\s|^\s*update\s|^\s*delete\s/i;

const LIST_ITEM = /^(\d+[.、)）]\s+|[-·•*]\s+|[（(]\d+[)）]\s*)/;

/** 短行且无句末标点，可能是小标题 */
function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 24) return false;
  if (SENTENCE_END.test(t)) return false;
  if (LIST_ITEM.test(t)) return false;
  if (CODE_START.test(t) || CODE_HINT.test(t)) return false;
  // "新建状态（ New）" 这类带括号注解的短行是列表项，不是标题
  if (/[（(][^）)]{1,20}[）)]\s*$/.test(t) && !/[:：]$/.test(t)) return false;
  // 冒号结尾的确定是标题
  if (/[:：]$/.test(t)) return true;
  // 其余要求不含句中标点
  return !/[，、]/.test(t);
}

/**
 * 把清洗后的纯文本切成可分别渲染的块。
 * 目的是让答案在页面上有层次，而不是一坨等权重的文字。
 */
export function parseAnswerBlocks(text: string): AnswerBlock[] {
  const lines = text.split("\n");
  const blocks: AnswerBlock[] = [];

  let para: string[] = [];
  let list: { items: string[]; ordered: boolean } | null = null;
  let code: string[] = [];
  let inCode = false;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "paragraph", text: para.join("\n") });
      para = [];
    }
  };
  const flushList = () => {
    if (list?.items.length) {
      blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    }
    list = null;
  };
  const flushCode = () => {
    if (code.length) {
      const text = code.join("\n").trim();
      if (text) blocks.push({ type: "code", text });
      code = [];
    }
    inCode = false;
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushCode();
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      // 空行：结束当前代码块；段落只在遇到空行时断开
      if (inCode) flushCode();
      flushPara();
      flushList();
      continue;
    }

    // 代码块判定
    if (inCode) {
      if (SQL_EXAMPLE.test(line)) {
        // 行内 SQL 举例不算代码，退出代码块
        flushCode();
      } else if (
        CODE_HINT.test(line) ||
        CODE_START.test(line) ||
        /^\s{2,}/.test(raw) ||
        // 代码块内部的普通行（如变量声明、括号结束）也并入
        /^[\w\s.,()<>="'\[\]+*/-]+$/.test(line)
      ) {
        code.push(raw);
        continue;
      } else {
        flushCode();
      }
    } else if (SQL_EXAMPLE.test(line) || URL_LIKE.test(line)) {
      // SQL 举例与 URL 按普通段落处理，不进代码块
    } else if (CODE_START.test(line) || (CODE_HINT.test(line) && line.length > 8)) {
      flushPara();
      flushList();
      inCode = true;
      code.push(raw);
      continue;
    }

    // 小标题
    if (looksLikeHeading(line)) {
      flushAll();
      blocks.push({ type: "heading", text: line.replace(/[:：]$/, "") });
      continue;
    }

    // 列表项
    const listMatch = line.match(LIST_ITEM);
    if (listMatch) {
      flushPara();
      const ordered = /^\d/.test(listMatch[0].trim());
      if (!list) list = { items: [], ordered };
      // 有序/无序混排时另起一个列表
      else if (list.ordered !== ordered) {
        flushList();
        list = { items: [], ordered };
      }
      list.items.push(line.replace(LIST_ITEM, "").trim());
      continue;
    }

    flushList();
    para.push(line);
  }

  flushAll();
  return blocks;
}

// ---------- 重生成答案的分段解析 ----------
//
// 新答案（scripts/regen-answers.mjs 生成）结构固定：
//   第 1 行：一句话结论
//   1. 要点标题        ← 编号 + 短标题（可能带冒号）
//   正文……
//   - set(T value)：xxx  ← 子项
//
// 旧答案没有这个结构，用上面的 parseAnswerBlocks 兜底。

export type AnswerSection = {
  type: "lead" | "section" | "prose" | "code";
  /** 结论文本 / 要点标题 */
  title?: string;
  body: string;
  items: AnswerItem[];
};

export type AnswerItem = { label?: string; text: string };

/** 编号，兼容阿拉伯数字与中文数字：`1.` `一、` `(1)` */
const NUM = "(\\d{1,2}|[一二三四五六七八九十]{1,3})";

/**
 * 编号与标题之间的分隔符可能叠用：`1. ` `1、` `1)` `1).` `(1) `。
 * 只吃掉一个会留下多余的 `.`，标题变成「. 实现 Serializable 接口」。
 */
const SEP = "[.．、)）]{1,3}";

/** 编号小标题，冒号可有可无：`1. 底层数据结构设计` / `一、底层机制：` */
const SECTION_HEAD = new RegExp(`^${NUM}${SEP}\\s*([^，。；]{2,40}?)[：:]?\\s*$`);
/**
 * 编号 + 标题 + 同一行就有正文，冒号可有可无：
 *   `1. 可重入实现：内部 Sync 继承 AQS…`
 *   `1. 变量可见性。JMM 抽象出主内存…`   ← 标题以句号结尾，正文紧随其后
 */
const SECTION_INLINE = new RegExp(`^${NUM}${SEP}\\s*([^，；：。]{2,24})[：:。]\\s*(\\S.{5,})$`);

/**
 * 兜底：编号后直接是一长句、没有独立标题。取到第一个逗号/分号为止当标题。
 *   `1. Runnable 只有 void run()，不能返回结果…` → 标题「Runnable 只有 void run()」
 */
const SECTION_LOOSE = new RegExp(`^${NUM}${SEP}\\s*([^，；：。]{2,30})[，；]\\s*(\\S.{5,})$`);

/** 子项：`- set(T value)：xxx` / `• 抽象：xxx` */
const BULLET_ITEM = /^[-·•*]\s*(.*)$/;

/** 子项里的「标签：正文」拆开，标签用于加粗 */
function splitLabel(text: string): AnswerItem {
  const m = text.match(/^([^：:]{1,30})[：:]\s*(\S.*)$/);
  // 标签本身不能是长句，也不能以标点结尾
  if (m && !/[，。；]/.test(m[1])) return { label: m[1].trim(), text: m[2].trim() };
  return { text };
}

export function parseAnswerSections(raw: string): AnswerSection[] {
  const lines = raw.split("\n").map((l) => l.trim());
  const out: AnswerSection[] = [];
  let cur: AnswerSection | null = null;
  const lead: string[] = [];
  let code: string[] = [];

  // 代码单独成段，不和正文混在 items 里
  const flushCode = () => {
    if (code.length) {
      const body = code.join("\n").trim();
      if (body) out.push({ type: "code", body, items: [] });
      code = [];
      cur = null;
    }
  };
  const pushProse = () => {
    cur = { type: "prose", body: "", items: [] };
    out.push(cur);
    return cur;
  };

  for (const line of lines) {
    if (!line) { flushCode(); continue; }

    // 已在代码块内：只有明显的新段落才退出，其余一律并入
    if (code.length) {
      const isCodeLike =
        CODE_START.test(line) ||
        CODE_HINT.test(line) ||
        /^\s{2,}/.test(line) ||
        /^[\w\s.,()<>="'\[\]+*/$&|?:-]+$/.test(line) ||
        /^[})]/.test(line) ||
        /[{(;]$/.test(line);
      if (isCodeLike) { code.push(line); continue; }
      flushCode();
    }

    // 代码块起点
    if (CODE_START.test(line) || (CODE_HINT.test(line) && line.length > 8)) {
      code.push(line);
      continue;
    }

    // 规范编号小标题
    const head = line.match(SECTION_HEAD);
    if (head) {
      cur = { type: "section", title: head[2].trim(), body: "", items: [] };
      out.push(cur);
      continue;
    }
    // 编号 + 标题 + 行内正文
    // 代码注释或代码行里的编号不算小标题
    const looksCode = /[;{}]\s*$|^\s*(\/\/|\*|#)/.test(line);
    const inline = looksCode ? null : (line.match(SECTION_INLINE) ?? line.match(SECTION_LOOSE));
    if (inline && !/^\d+\.\s*\d/.test(line)) {
      cur = { type: "section", title: inline[2].trim(), body: inline[3].trim(), items: [] };
      out.push(cur);
      continue;
    }

    // 子项
    const bullet = line.match(BULLET_ITEM);
    if (bullet) {
      (cur ?? pushProse()).items.push(splitLabel(bullet[1]));
      continue;
    }

    // 还没遇到任何小标题 → 归入结论
    if (!out.some((s) => s.type === "section")) {
      lead.push(line);
      continue;
    }

    // 其余正文：接到当前小节的 body
    const target = cur ?? pushProse();
    target.body = target.body ? `${target.body}\n${line}` : line;
  }
  flushCode();

  // 结论段放最前
  if (lead.length) out.unshift({ type: "lead", body: lead.join("\n"), items: [] });
  return out.filter((s) => s.type === "lead" || s.title || s.body || s.items.length);
}

/** 是否为新格式：第一行是完整句子且后面跟着编号小节 */
export function hasSections(raw: string): boolean {
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length < 2) return false;
  return lines
    .slice(1)
    .some(
      (l) =>
        SECTION_HEAD.test(l.trim()) ||
        SECTION_INLINE.test(l.trim()) ||
        SECTION_LOOSE.test(l.trim()),
    );
}
