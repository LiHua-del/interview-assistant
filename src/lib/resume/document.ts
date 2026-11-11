/** 原文阅读稿；只整理排版，不使用模型摘要替代原文。 */
export type ResumeBlock = {
  id: string;
  text: string;
  kind: "heading" | "paragraph" | "bullet";
  page: number | null;
};

export type ResumeDocument = {
  version: 1;
  id: string;
  source: "pdf" | "markdown" | "legacy";
  markdown: string;
  blocks: ResumeBlock[];
  warnings: string[];
};

export type ResumeReference = {
  documentId: string;
  status: "matched" | "ambiguous" | "missing" | "none";
  spans: { blockId: string; start: number; end: number }[];
};

const SECTION = /^(基本信息|个人信息|个人简介|教育经历|教育背景|工作经历|实习经历|项目经历|项目经验|专业技能|技能清单|技能特长|荣誉奖项|自我评价|联系方式)[：:]?$/;

export function createResumeDocument(
  pages: { text: string; page: number | null }[],
  source: ResumeDocument["source"],
  warnings: string[] = [],
): ResumeDocument {
  const blocks: ResumeBlock[] = [];
  for (const page of pages) {
    for (const line of page.text.split(/\r?\n/)) {
      const original = line.trim();
      if (!original) continue;
      const heading = source === "markdown" && /^#{1,6}\s+/.test(original);
      const bullet = /^(?:[-*•●▪]|\d+[.)、])\s+/.test(original);
      const text = heading ? original.replace(/^#{1,6}\s+/, "") : original;
      blocks.push({
        id: `b${blocks.length + 1}`,
        text,
        kind: heading || SECTION.test(text.replace(/\s/g, "")) ? "heading" : bullet ? "bullet" : "paragraph",
        page: page.page,
      });
    }
  }
  // 内容指纹把偏移绑定到具体阅读稿，旧题单不会沿用另一版简历的坐标。
  let hash = 2166136261;
  const content = JSON.stringify(blocks);
  for (let i = 0; i < content.length; i++) hash = Math.imul(hash ^ content.charCodeAt(i), 16777619);
  const escape = (text: string) => text.replace(/[\\`*_{}\[\]()<>#+.!|~\-]/g, "\\$&");
  let previousPage: number | null = null;
  const markdown = blocks.map((block) => {
    const pageLabel = block.page !== null && block.page !== previousPage ? `<!-- PDF 第 ${block.page} 页 -->\n\n` : "";
    previousPage = block.page;
    return `${pageLabel}<!-- ${block.id} -->\n${block.kind === "heading" ? "## " : ""}${escape(block.text)}`;
  }).join("\n\n");
  return { version: 1, id: `resume-v1-${(hash >>> 0).toString(16)}`, source, markdown, blocks, warnings };
}

// 只忽略排版空白及引号/中文句读；保留 C++、C#、百分比等有意义的符号。
const IGNORABLE = /[\s，。、；："“”'‘’]/;

export function resolveResumeAnchor(document: ResumeDocument, anchor: string): ResumeReference {
  const empty = (status: ResumeReference["status"]): ResumeReference => ({ documentId: document.id, status, spans: [] });
  if (!anchor.trim()) return empty("none");
  const needle = [...anchor].filter((char) => !IGNORABLE.test(char)).join("");
  if (needle.length < 6) return empty("missing");
  let text = "";
  const offsets: { blockId: string; start: number; end: number }[] = [];
  for (const block of document.blocks) {
    for (let index = 0; index < block.text.length; index++) {
      const char = block.text[index];
      if (IGNORABLE.test(char)) continue;
      text += char;
      offsets.push({ blockId: block.id, start: index, end: index + 1 });
    }
  }
  const start = text.indexOf(needle);
  if (start < 0) return empty("missing");
  if (text.indexOf(needle, start + 1) >= 0) return empty("ambiguous");
  const spans: ResumeReference["spans"] = [];
  for (const position of offsets.slice(start, start + needle.length)) {
    const last = spans.at(-1);
    if (last?.blockId === position.blockId) last.end = position.end;
    else spans.push({ ...position });
  }
  return { documentId: document.id, status: "matched", spans };
}
