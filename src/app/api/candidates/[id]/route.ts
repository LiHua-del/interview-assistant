import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { candidates } from "@/lib/db/schema";

/**
 * 删除候选人。
 * 数据库里的关联记录（题单、轮次、评估）由外键 ON DELETE CASCADE 处理，
 * 但上传的简历文件在磁盘上，需要单独清理。
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const c = db.select().from(candidates).where(eq(candidates.id, id)).get();
  if (!c) {
    return NextResponse.json({ error: "候选人不存在" }, { status: 404 });
  }

  db.delete(candidates).where(eq(candidates.id, id)).run();

  // 删掉该候选人的上传目录；失败不影响删除结果，只记日志
  const dir = path.join(process.cwd(), "data", "uploads", id);
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (e) {
    console.error(`[delete] 清理简历文件失败 ${dir}:`, e);
  }

  return NextResponse.json({ ok: true, name: c.name });
}
