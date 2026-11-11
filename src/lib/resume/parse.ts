import fs from "node:fs/promises";
import path from "node:path";
import { askJson } from "@/lib/llm/client";
import { RESUME_PARSE } from "@/lib/prompts";
import { parsedResumeSchema } from "@/lib/llm/schemas";
import type { ParsedResume } from "@/lib/db/schema";
import { createResumeDocument, type ResumeDocument } from "./document";

/** 每页平均字符数低于此值 → 判定为扫描件 */
const SCANNED_PDF_CHAR_THRESHOLD = 80;

export class ResumeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeParseError";
  }
}

/**
 * 模型输出的字段名不稳定（basic_info / 教育经历 / 实习经历 等）。
 * 在 schema 校验前统一归一化，避免因为键名不同就整份简历解析失败。
 */
function normalizeParsedResume(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const o = raw as Record<string, unknown>;

  const first = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (o[k] !== undefined && o[k] !== null) return o[k];
    }
    return undefined;
  };

  const asArray = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? (v.filter((x) => typeof x === "object" && x !== null) as Record<string, unknown>[]) : [];

  const str = (v: unknown): string =>
    typeof v === "string" ? v : typeof v === "number" ? String(v) : "";

  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === "string" && v ? [v] : [];

  const basicRaw = first("basic", "basic_info", "basicInfo", "基本信息", "profile");
  const basic = (typeof basicRaw === "object" && basicRaw !== null
    ? basicRaw
    : {}) as Record<string, unknown>;

  const eduRaw = first(
    "education",
    "educations",
    "教育背景",
    "教育经历",
  );
  const education = asArray(
    Array.isArray(eduRaw)
      ? eduRaw
      : (basic as Record<string, unknown>).education,
  ).map((e) => ({
    school: str(e.school ?? e.学校 ?? e.university),
    major: str(e.major ?? e.专业),
    degree: str(e.degree ?? e.学历),
    period: str(e.period ?? e.time ?? e.起止时间 ?? e.date),
  }));

  const internships = asArray(
    first("internships", "internship", "实习经历", "工作经历", "experience"),
  ).map((x) => {
    const raw = str(x.raw ?? x.原文 ?? x.source);
    // 模型常把整段原文塞进 raw，而把 period/details 留空。
    // 用 raw 做兜底抽取，保证下游（风险扫描、出题）拿到可用内容。
    const periodFromRaw =
      raw.match(/(\d{4}\s*[.\-/年]\s*\d{1,2}.*?[-–—~至].*?\d{4}\s*[.\-/年]?\s*\d{0,2})/)?.[1] ??
      "";
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    return {
      company: str(x.company ?? x.公司),
      role: str(x.role ?? x.position ?? x.职位 ?? x.岗位),
      period: str(x.period ?? x.time ?? x.起止时间) || periodFromRaw,
      details:
        str(x.details ?? x.description ?? x.职责 ?? x.描述) ||
        lines.slice(1).join("\n"),
      techStack: strArray(x.techStack ?? x.tech ?? x.技术栈),
      raw,
    };
  });

  const projects = asArray(first("projects", "project", "项目经历")).map(
    (x) => {
      const raw = str(x.raw ?? x.原文 ?? x.source);
      const periodFromRaw =
        raw.match(/(\d{4}\s*[.\-/年]\s*\d{1,2}.*?[-–—~至].*?\d{4}\s*[.\-/年]?\s*\d{0,2})/)?.[1] ??
        "";
      const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
      return {
        name: str(x.name ?? x.title ?? x.项目名称),
        period: str(x.period ?? x.time ?? x.时间) || periodFromRaw,
        background:
          str(x.background ?? x.description ?? x.背景 ?? x.简介) ||
          lines.slice(1).join("\n"),
        role: str(x.role ?? x.角色),
        techStack: strArray(x.techStack ?? x.tech ?? x.技术栈),
        achievements: strArray(x.achievements ?? x.成果 ?? x.highlights),
        raw,
      };
    },
  );

  const skillsRaw = first("skills", "skill", "技能", "技能清单");
  const skills = Array.isArray(skillsRaw)
    ? strArray(skillsRaw)
    : typeof skillsRaw === "object" && skillsRaw !== null
      ? Object.values(skillsRaw).flatMap((v) => strArray(v))
      : [];

  const timeline = asArray(first("timeline", "时间线")).map((t) => ({
    event: str(t.event ?? t.事件),
    period: str(t.period ?? t.time ?? t.时间),
  }));

  return {
    ...o,
    basic: {
      name: str(basic.name ?? (o.name as unknown)),
      education,
    },
    internships,
    projects,
    skills,
    timeline,
  };
}

export async function extractPdfText(buffer: Buffer): Promise<{
  text: string;
  pages: number;
  charsPerPage: number;
  pageTexts: { text: string; page: number }[];
}> {
  // 在 Next.js 服务端运行时，pdfjs 的 default 构建会尝试加载 worker 文件，
  // 而打包后该路径不存在（.next/dev/server/chunks/pdf.worker.mjs）。
  // 服务端解析是同步的，不需要 worker，因此注入主线程的 message handler。
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const g = globalThis as unknown as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker && "WorkerMessageHandler" in pdfjs) {
    g.pdfjsWorker = {
      WorkerMessageHandler: (
        pdfjs as unknown as { WorkerMessageHandler: unknown }
      ).WorkerMessageHandler,
    };
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableWorker: true,
    isEvalSupported: false,
  } as Parameters<typeof pdfjs.getDocument>[0]);

  const parts: string[] = [];
  const pageTexts: { text: string; page: number }[] = [];
  try {
    const doc = await loadingTask.promise;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(
        content.items
          .map((it) => ("str" in it ? it.str : ""))
          .join(" "),
      );
      const lines: string[] = [];
      let line = "";
      let lastY: number | undefined;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5];
        if (lastY !== undefined && Math.abs(y - lastY) > 3 && line.trim()) {
          lines.push(line.trim());
          line = "";
        }
        line += `${item.str} `;
        lastY = y;
        if (item.hasEOL) {
          if (line.trim()) lines.push(line.trim());
          line = "";
          lastY = undefined;
        }
      }
      if (line.trim()) lines.push(line.trim());
      pageTexts.push({ text: lines.join("\n"), page: i });
    }

    const text = parts.join("\n").replace(/[ \t]+/g, " ").trim();
    return {
      text,
      pages: doc.numPages,
      charsPerPage: text.length / Math.max(doc.numPages, 1),
      pageTexts,
    };
  } finally {
    await loadingTask.destroy();
  }
}

export async function readResumeFile(
  file: File,
): Promise<{ rawText: string; format: "pdf" | "markdown"; document: ResumeDocument }> {
  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".md") || name.endsWith(".markdown")) {
    const rawText = buffer.toString("utf8");
    return { rawText, format: "markdown", document: createResumeDocument([{ text: rawText, page: null }], "markdown") };
  }

  if (name.endsWith(".pdf")) {
    const { text, pages, charsPerPage, pageTexts } = await extractPdfText(buffer);
    if (charsPerPage < SCANNED_PDF_CHAR_THRESHOLD) {
      throw new ResumeParseError(
        `这份 PDF 抽取到 ${Math.round(charsPerPage)} 字符/页（共 ${pages} 页），判定为扫描件或纯图片。` +
          `本项目不做 OCR，请提供文字版 PDF 或 Markdown 文件。`,
      );
    }
    return { rawText: text, format: "pdf", document: createResumeDocument(pageTexts, "pdf") };
  }

  throw new ResumeParseError("仅支持 PDF 或 Markdown 文件");
}

export async function parseResume(rawText: string): Promise<ParsedResume> {
  const parsed = await askJson(
    RESUME_PARSE.system,
    RESUME_PARSE.user(rawText),
    parsedResumeSchema,
    { temperature: 0.1, retries: 2, preprocess: normalizeParsedResume },
  );
  return { ...parsed, charCount: rawText.length };
}

/** 保存原始简历到 data/uploads/{candidateId}/ */
export async function saveResumeFile(
  candidateId: string,
  file: File,
  document?: ResumeDocument,
): Promise<string> {
  const dir = path.join(process.cwd(), "data", "uploads", candidateId);
  await fs.mkdir(dir, { recursive: true });
  const safeName = path.basename(file.name).replace(/[^\w.\-一-龥]/g, "_");
  const dest = path.join(dir, safeName);
  await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));
  if (document) await fs.writeFile(`${dest}.reading.md`, document.markdown, "utf8");
  return path.relative(process.cwd(), dest);
}

/** 旧数据只读兼容，不在访问页面时改写数据库或原文件。 */
export async function loadResumeDocument(candidate: {
  resumeParsed: ParsedResume;
  resumeFile: string | null;
  resumeRawText: string;
  resumeFormat: "pdf" | "markdown";
}): Promise<ResumeDocument> {
  if (candidate.resumeParsed.document?.version === 1) return candidate.resumeParsed.document;
  if (candidate.resumeFile && candidate.resumeFormat === "pdf") {
    try {
      const { pageTexts } = await extractPdfText(await fs.readFile(resumeFilePath(candidate.resumeFile)));
      if (pageTexts.some((page) => page.text.trim())) return createResumeDocument(pageTexts, "pdf");
    } catch {
      // 原始文件缺失时依然允许使用历史题单，但不编造 PDF 页码。
    }
  }
  return createResumeDocument(
    [{ text: candidate.resumeRawText, page: null }],
    candidate.resumeFormat === "markdown" ? "markdown" : "legacy",
    candidate.resumeFormat === "pdf" ? ["原始 PDF 不可用，当前展示历史提取文本，无法确认来源页码。"] : [],
  );
}

export function resumeFilePath(file: string): string {
  const root = path.resolve(process.cwd(), "data", "uploads");
  const resolved = path.resolve(process.cwd(), file);
  if (!resolved.startsWith(root + path.sep)) throw new ResumeParseError("简历文件路径无效");
  return resolved;
}

/**
 * 校验题目的 resumeAnchor 确实出现在简历原文里。
 * 这是防幻觉的硬约束：引用不上的题目直接丢弃。
 */
export function anchorExists(anchor: string, rawText: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, "").replace(/[，。、；：""'']/g, "");
  const a = norm(anchor);
  if (a.length < 6) return false;
  return norm(rawText).includes(a);
}
