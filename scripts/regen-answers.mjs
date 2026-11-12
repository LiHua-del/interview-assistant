/**
 * 用本地模型重写题库答案。
 *
 * 用法：
 *   node scripts/regen-answers.mjs --category 并发 [--limit N] [--dry-run]
 *
 * 逐题调用，结果先落 data/regen-stage/<category>.json，可断点续跑；
 * 全部完成后再统一写库，中途失败不会留下半成品。
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const STAGE = "data/regen-stage";
fs.mkdirSync(STAGE, { recursive: true });

function env(k) {
  const t = fs.readFileSync(".env.local", "utf8");
  return (t.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
}
const KEY = env("LLM_API_KEY");
const BASE = env("LLM_BASE_URL") || "http://127.0.0.1:7863/v1";
const MODEL = "cn:hy4free";

const SYSTEM = `你是资深 Java 后端面试官，为内部面试题库撰写标准答案。

输出要求：
1. 只输出答案正文。不要重复题目、不要写"答案：""答："之类的引导词、不要 markdown 代码围栏。
2. 开头一句话给结论，然后分点展开技术细节。
3. 讲原理要落到实现层面（数据结构、关键方法、底层机制），不要只给定义。
4. 篇幅 300-800 字，中文技术表述，去掉口语化废话。
5. 如果题目残缺（只有名词短语或"两者的不同点"这类丢了主语的片段），
   先根据答案上下文与你的专业知识判断它实际问的是什么，在答案第一句里
   用「」标出你理解的完整问法，再作答。不要拒绝作答。`;

async function gen(question, oldAnswer, level) {
  const user = level > 0
    ? `题目：${question}\n\n（参考现有答案的线索，但请重新组织并补全：\n${oldAnswer.slice(0, 800)}\n）`
    : `题目：${question}`;
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
      max_tokens: 8000,
    }),
    signal: AbortSignal.timeout(420000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const j = await res.json();
  const c = j.choices?.[0]?.message?.content ?? "";
  return c.trim();
}

async function rewriteQ(question, answer) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `你是面试题库编辑。给你一条残缺的题目和一个答案，请把题目改写成完整、口语化的面试问句。
规则：
- 保留原题的技术对象，不要引入答案里没有的概念
- 输出只包含改写后的题目一句，不加编号、引号、解释
- 例如「两者的不同点。」配合讲 synchronized 与 ReentrantLock 的答案 → 「synchronized 和 ReentrantLock 有哪些不同点？」
- 若原题已经完整，原样返回`,
        },
        { role: "user", content: `题目：${question}\n\n答案：${answer.slice(0, 1000)}` },
      ],
      max_tokens: 4000,
    }),
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return (j.choices?.[0]?.message?.content ?? "").trim().replace(/^["「『]|["」』]$/g, "");
}

// 题目是否残缺：无疑问词且像名词短语
const QW = /(什么|为什么|如何|怎么|哪些|是否|区别|原理|作用|机制|实现|谈谈|说说|简述|介绍|比较|能不能|可否|？|\?)/;
const needsRewrite = (q) => !QW.test(q) || /^.{0,10}[。.]$/.test(q.trim());

function quality(text) {
  if (!text || text.length < 60) return "too-short";
  if (/^(抱歉|无法|作为|很抱歉)/.test(text)) return "refusal";
  if (!/[。；：]$/m.test(text)) return "no-punct";
  return "ok";
}

async function withRetry(fn, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn();
      if (v && v.length >= 40) return { ok: true, value: v };
      if (i === tries - 1) return { ok: false, error: `质量不合格(${quality(v)})` };
    } catch (e) {
      if (i === tries - 1) return { ok: false, error: e.message.slice(0, 80) };
    }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  return { ok: false, error: "unknown" };
}

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i === -1 ? null : args[i + 1]; };
const category = arg("--category");
const limit = Number(arg("--limit") ?? 0);
const dryRun = args.includes("--dry-run");
const concurrency = Number(arg("--concurrency") ?? 3);

if (!category) { console.error("必须指定 --category"); process.exit(1); }

const db = new Database("data/app.db", { readonly: true });
let rows = db.prepare("select id, question, answer from questions_pool where category = ? order by id").all(category);
db.close();
if (limit) rows = rows.slice(0, limit);
if (!rows.length) { console.error(`分类「${category}」没有题目`); process.exit(1); }

const stagePath = path.join(STAGE, `${category}.json`);
const done = new Map();
if (fs.existsSync(stagePath)) {
  for (const r of JSON.parse(fs.readFileSync(stagePath, "utf8"))) done.set(r.id, r);
  console.log(`复用已完成 ${done.size} 条`);
}

const todo = rows.filter((r) => !done.has(r.id) || !done.get(r.id).ok);
console.log(`「${category}」共 ${rows.length} 题，待处理 ${todo.length} 题，并发 ${concurrency}`);

let cursor = 0, finished = 0;
const results = [...rows].map((r) => done.get(r.id) ?? { id: r.id, question: r.question, ok: false });

function save() {
  fs.writeFileSync(
    stagePath,
    JSON.stringify(results.sort((a, b) => a.id.localeCompare(b.id)), null, 1),
  );
}

async function worker() {
  while (true) {
    const i = cursor++;
    if (i >= todo.length) return;
    const row = todo[i];
    const t0 = Date.now();

    let question = row.question;
    let rewritten = false;
    if (needsRewrite(question)) {
      const r = await withRetry(() => rewriteQ(question, row.answer));
      if (r.ok && r.value.length >= 6 && r.value !== question) {
        question = r.value;
        rewritten = true;
      }
    }

    // 先不带旧答案；不足 300 字再带旧答案重试一次
    let ans = await withRetry(() => gen(question, "", 0));
    if (ans.ok && ans.value.length < 300) {
      const retry = await withRetry(() => gen(question, row.answer, 1));
      if (retry.ok && retry.value.length > ans.value.length) ans = retry;
    }

    const idx = results.findIndex((x) => x.id === row.id);
    if (ans.ok) {
      results[idx] = {
        id: row.id, question, answer: ans.value, rewritten,
        oldQuestion: row.question, ok: true, ms: Date.now() - t0,
      };
    } else {
      results[idx] = {
        id: row.id, question: row.question, oldQuestion: row.question,
        ok: false, error: ans.error, ms: Date.now() - t0,
      };
    }
    finished++;
    save();
    const tag = ans.ok ? `${results[idx].answer.length}字${rewritten ? " 改题" : ""}` : `失败:${ans.error}`;
    console.log(`  [${finished}/${todo.length}] ${row.id} ${((Date.now() - t0) / 1000).toFixed(0)}s ${tag}`);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));

const okCount = results.filter((r) => r.ok).length;
console.log(`\n完成：成功 ${okCount} / ${results.length}，失败 ${results.length - okCount}`);

if (dryRun) { console.log("--dry-run，不写库"); process.exit(0); }

const final = results.filter((r) => r.ok);
if (!final.length) { console.error("没有可写入的结果"); process.exit(1); }

const wdb = new Database("data/app.db");
wdb.pragma("journal_mode = WAL");
const upd = wdb.prepare(
  "update questions_pool set question = ?, answer = ?, regen_version = 1 where id = ?",
);
const tx = wdb.transaction((list) => {
  for (const r of list) upd.run(r.question.slice(0, 500), r.answer, r.id);
});
tx(final);
wdb.close();
console.log(`已写库 ${final.length} 条（改写题目 ${final.filter((r) => r.rewritten).length} 条）`);
