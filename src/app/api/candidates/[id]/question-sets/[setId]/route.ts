import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { questionSets } from "@/lib/db/schema";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; setId: string }> },
) {
  const { id, setId } = await params;
  try {
    // 同一条语句核对归属并删除；不允许误删其他候选人或岗位基底题单。
    // rounds.questionSetId 的 ON DELETE SET NULL 保留已有纪要与评估。
    const result = db.delete(questionSets).where(and(
      eq(questionSets.id, setId),
      eq(questionSets.candidateId, id),
      eq(questionSets.isBase, false),
    )).run();
    if (!result.changes) {
      return NextResponse.json({ error: "该候选人的题单不存在或已被删除" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id: setId });
  } catch {
    return NextResponse.json({ error: "题单删除失败，请重试" }, { status: 500 });
  }
}
