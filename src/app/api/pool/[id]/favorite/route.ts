import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { questionsPool } from "@/lib/db/schema";

/** 切换收藏状态，返回切换后的值 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const row = db
    .select({ favorite: questionsPool.favorite })
    .from(questionsPool)
    .where(eq(questionsPool.id, id))
    .get();

  if (!row) {
    return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  }

  let next: boolean;
  const body = (await req.json().catch(() => ({}))) as { favorite?: boolean };
  next = typeof body.favorite === "boolean" ? body.favorite : !row.favorite;

  db.update(questionsPool)
    .set({ favorite: next })
    .where(eq(questionsPool.id, id))
    .run();

  return NextResponse.json({ id, favorite: next });
}
