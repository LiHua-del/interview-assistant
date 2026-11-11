import { db } from "@/lib/db";
import { questionsPool } from "@/lib/db/schema";
import { sql, and, eq, or, like } from "drizzle-orm";
import { Empty } from "@/components/ui";
import { PoolBrowser } from "@/components/PoolBrowser";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

export default async function PoolPage({ searchParams }: PageProps<"/pool">) {
  const sp = await searchParams;
  const keyword = typeof sp.q === "string" ? sp.q : "";
  const category = typeof sp.c === "string" ? sp.c : "";
  const favoritesOnly = sp.f === "1";
  const page = Math.max(0, Number(typeof sp.p === "string" ? sp.p : "1") - 1 || 0);

  const dist = db
    .select({ category: questionsPool.category, count: sql<number>`count(*)` })
    .from(questionsPool)
    .groupBy(questionsPool.category)
    .all()
    .sort((a, b) => b.count - a.count);

  const total = dist.reduce((s, d) => s + d.count, 0);
  const favoriteCount =
    db
      .select({ c: sql<number>`count(*)` })
      .from(questionsPool)
      .where(eq(questionsPool.favorite, true))
      .get()?.c ?? 0;

  const where = and(
    category ? eq(questionsPool.category, category) : undefined,
    favoritesOnly ? eq(questionsPool.favorite, true) : undefined,
    keyword
      ? or(
          like(questionsPool.question, `%${keyword}%`),
          like(questionsPool.answer, `%${keyword}%`),
          like(questionsPool.tags, `%${keyword}%`),
        )
      : undefined,
  );

  const rows = db
    .select()
    .from(questionsPool)
    .where(where)
    .orderBy(
      sql`favorite desc`,
      sql`duplicates desc`,
      sql`length(answer) desc`,
    )
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE)
    .all();

  const filteredCount =
    db
      .select({ c: sql<number>`count(*)` })
      .from(questionsPool)
      .where(where)
      .get()?.c ?? 0;

  if (total === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">题库</h1>
        <Empty>
          题库为空。运行{" "}
          <code className="rounded bg-neutral-100 px-1">
            node scripts/import-pool.mjs
          </code>{" "}
          导入。
        </Empty>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">题库</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {total} 道题，按技术栈分类。出题时会按岗位 JD 匹配相关题目。
        </p>
      </div>

      <PoolBrowser
        items={rows.map((r) => ({
          id: r.id,
          category: r.category,
          tags: r.tags,
          question: r.question,
          answer: r.answer,
          difficulty: r.difficulty,
          duplicates: r.duplicates,
          favorite: r.favorite,
        }))}
        categories={dist.map((d) => ({ name: d.category, count: d.count }))}
        total={total}
        favoriteCount={favoriteCount}
        keyword={keyword}
        category={category}
        favoritesOnly={favoritesOnly}
        page={page}
        pageCount={Math.max(1, Math.ceil(filteredCount / PAGE_SIZE))}
        filteredCount={filteredCount}
      />
    </div>
  );
}
