import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { candidates } from "@/lib/db/schema";
import { readResumeFile, parseResume, saveResumeFile } from "@/lib/resume/parse";
import { scanRisks } from "@/lib/analysis/risk";
import { ResumeParseError } from "@/lib/resume/parse";
import { LLMError } from "@/lib/llm/client";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const jd = (form.get("jd") as string | null)?.trim() ?? "";
    const nameInput = (form.get("name") as string | null)?.trim() ?? "";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "缺少简历文件" }, { status: 400 });
    }

    const { rawText, format, document } = await readResumeFile(file);
    const parsed = await parseResume(rawText);

    const name = nameInput || parsed.basic.name || "未命名候选人";
    const id = randomUUID();
    const resumeFile = await saveResumeFile(id, file, document);

    const risks = jd ? await scanRisks(jd, parsed) : [];
    parsed.document = document;

    db.insert(candidates)
      .values({
        id,
        name,
        resumeFile,
        resumeFormat: format,
        resumeRawText: rawText,
        resumeParsed: parsed,
        riskReport: risks,
        status: "待面",
        tags: [],
      })
      .run();

    return NextResponse.json({ id, name, risks, parsed });
  } catch (err) {
    if (err instanceof ResumeParseError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof LLMError) {
      return NextResponse.json(
        { error: `${err.message}${err.detail ? `：${err.detail}` : ""}` },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "解析失败" },
      { status: 500 },
    );
  }
}
