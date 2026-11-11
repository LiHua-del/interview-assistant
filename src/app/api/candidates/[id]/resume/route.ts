import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import fs from "node:fs/promises";
import { db } from "@/lib/db";
import { candidates } from "@/lib/db/schema";
import { loadResumeDocument, resumeFilePath } from "@/lib/resume/parse";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const candidate = db.select().from(candidates).where(eq(candidates.id, id)).get();
  if (!candidate) return NextResponse.json({ error: "候选人不存在" }, { status: 404 });
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (req.nextUrl.searchParams.get("format") === "markdown") {
    const document = await loadResumeDocument(candidate);
    return new Response(document.markdown, { headers: {
      ...headers,
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": "attachment; filename=resume.md",
    } });
  }
  if (!candidate.resumeFile) return NextResponse.json({ error: "原始简历文件不可用" }, { status: 404 });
  try {
    const buffer = await fs.readFile(resumeFilePath(candidate.resumeFile));
    return new Response(new Uint8Array(buffer), { headers: {
      ...headers,
      "Content-Type": candidate.resumeFormat === "pdf" ? "application/pdf" : "text/plain; charset=utf-8",
      "Content-Disposition": candidate.resumeFormat === "pdf" ? "inline; filename=resume.pdf" : "attachment; filename=resume.md",
    } });
  } catch {
    return NextResponse.json({ error: "原始简历文件不可用，请使用 Markdown 阅读稿" }, { status: 404 });
  }
}
