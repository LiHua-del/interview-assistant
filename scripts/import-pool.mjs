/**
 * 面试题库导入流水线。
 *
 * 用法：
 *   node scripts/import-pool.mjs [--skip-repair] [--skip-classify] [--limit N]
 *
 * 阶段：
 *   1. 读取 data/pdftext/*.txt（已由 PDF 抽取）
 *   2. 清洗 + 切题
 *   3. 修复字体缺字占位符（仅受影响来源）
 *   4. LLM 批量归类打标
 *   5. 语义去重
 *   6. 写入 questions_pool
 *
 * 中间结果落在 data/pool-stage/，可断点续跑，不必每次从头跑 LLM。
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const STAGE = "data/pool-stage";
fs.mkdirSync(STAGE, { recursive: true });

const SOURCE_NAMES = {
  a: "1000道 互联网Java工程师面试题",
  b: "JAVA核心面试知识整理",
  c: "大厂后端面筋指南",
  d: "面试题全集（周瑜）",
};

// ---- 可在无 TS 运行时下复用的纯函数（与 src/lib/pool 保持一致）----

const RADICALS = { "⼀": "一", "⼁": "丨", "⼂": "丶", "⼈": "人", "⼉": "儿", "⼊": "入", "⼋": "八", "⼏": "几", "⼑": "刀", "⼒": "力", "⼗": "十", "⼜": "又", "⼝": "口", "⼟": "土", "⼤": "大", "⼥": "女", "⼦": "子", "⼧": "宀", "⼨": "寸", "⼩": "小", "⼫": "尸", "⼭": "山", "⼯": "工", "⼰": "己", "⼱": "巾", "⼲": "干", "⼴": "广", "⼸": "弓", "⼼": "心", "⼽": "戈", "⼾": "户", "⼿": "手", "⽀": "支", "⽂": "文", "⽅": "方", "⽆": "无", "⽇": "日", "⽈": "曰", "⽉": "月", "⽊": "木", "⽋": "欠", "⽌": "止", "⽐": "比", "⽑": "毛", "⽓": "气", "⽔": "水", "⽕": "火", "⽗": "父", "⽚": "片", "⽛": "牙", "⽜": "牛", "⽝": "犬", "⽟": "玉", "⽣": "生", "⽤": "用", "⽥": "田", "⽩": "白", "⽪": "皮", "⽫": "皿", "⽬": "目", "⽮": "矢", "⽯": "石", "⽰": "示", "⽲": "禾", "⽳": "穴", "⽴": "立", "⽵": "竹", "⽶": "米", "⽹": "网", "⽺": "羊", "⽻": "羽", "⽼": "老", "⽽": "而", "⽿": "耳", "⾁": "肉", "⾃": "自", "⾄": "至", "⾆": "舌", "⾈": "舟", "⾊": "色", "⾍": "虫", "⾎": "血", "⾏": "行", "⾐": "衣", "⾓": "角", "⾔": "言", "⾕": "谷", "⾖": "豆", "⾛": "走", "⾜": "足", "⾝": "身", "⾞": "车", "⾟": "辛", "⾠": "辰", "⾢": "邑", "⾥": "里", "⾦": "金", "⾨": "门", "⾪": "隶", "⾬": "雨", "⾮": "非", "⾯": "面", "⾰": "革", "⾳": "音", "⾴": "页", "⾵": "风", "⾶": "飞", "⾷": "食", "⾸": "首", "⾺": "马", "⾻": "骨", "⾼": "高", "⿂": "鱼", "⿃": "鸟", "⿅": "鹿", "⿊": "黑", "⿏": "鼠", "⿐": "鼻", "⿒": "齿", "⿓": "龙" };

function normalizeChars(t) {
  t = t.replace(/[⼀-⿟]/g, (c) => RADICALS[c] ?? c);
  for (let i = 0; i < 3; i++) t = t.replace(/([一-鿿]) +(?=[一-鿿])/g, "$1");
  return t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

function stripNoise(t) {
  return t
    .replace(/^第\s*\d+\s*页\s*共\s*\d+\s*页\s*$/gm, "")
    .replace(/^\d{2}\/\d{2}\/\d{4}\s+Page\s+\d+\s+of\s+\d+\s*$/gm, "")
    .replace(/^<<<PAGE \d+>>>$/gm, "")
    .replace(/^.*?\.{4,}\s*\d+\s*$/gm, "")
    .replace(/^.*?…{2,}\s*\d+\s*$/gm, "")
    .replace(/^\s*\d{1,4}\s*$/gm, "")
    .replace(/([？?。！!])\s+\d{1,3}\s*$/gm, "$1")
    .replace(/\n{3,}/g, "\n\n");
}

function cleanFull(t) {
  return stripNoise(normalizeChars(t));
}

const STYLES = {
  a: [/^\d{1,3}\s*[、．.]\s*\S{2,}/],
  b: [/^\d{1,2}(?:\.\d{1,2}){1,3}\.\s*\S{2,}/, /^\d{1,2}(?:\.\d{1,2}){1,3}\s+\S{2,}/],
  c: [/^\d{1,2}\.\d{1,2}\s+\S{2,}/],
  d: [],
};

const SECTION_CN = /^(Java|JVM|MySQL|Redis|Spring|并发|多线程|集合|设计模式|消息队列|分布式|微服务|网络|操作系统|数据结构|算法|数据库|Zookeeper|Kafka|Dubbo|Netty|Tomcat|Mybatis|Hibernate|Linux|Git|Maven|基础|综合)/i;


function isAnswerEnumeration(t) {
  if (!/^\d{1,2}\s*[、．.]\s*\S{2,}/.test(t)) return false;
  if (/[？?]\s*$/.test(t)) return false;
  if (/(什么|为什么|如何|怎么|哪些|是否|区别|原理|谈谈|说说|简述|请)/.test(t)) return false;
  return true;
}

function looksLikeQuestion(q) {
  if (/[？?]\s*$/.test(q)) return true;
  if (/(什么|为什么|如何|怎么|哪些|是否|区别|原理|谈谈|说说|简述|请|解释|描述|比较|介绍)/.test(q)) return true;
  if (q.length <= 30 && !/[。；;]/.test(q)) {
    const hits = (q.match(/(提供|支持|包括|由于|因此|从而|可以|需要|具有)/g) ?? []).length;
    if (hits <= 1) return true;
  }
  return false;
}

function splitQuestions(sourceKey, cleaned) {
  const pats = STYLES[sourceKey] ?? [];
  const lines = [];
  let page = 1;
  for (const raw of cleaned.split("\n")) {
    const m = raw.match(/^<<<PAGE (\d+)>>>$/);
    if (m) { page = Number(m[1]); continue; }
    const t = raw.trim();
    if (t) lines.push({ text: t, page });
  }

  const isStart = (t) =>
    (t.length >= 4 && pats.some((re) => re.test(t))) ||
    (/[？?]\s*$/.test(t) && t.length >= 8 && t.length <= 120);

  const out = [];
  let section = "";
  let cur = null;
  let idx = 0;

  const flush = () => {
    if (!cur) return;
    const question = cur.q.trim();
    const answer = cur.body.join("\n").trim();
    if (question.length >= 6 && question.length <= 200 && answer.length >= 10 && looksLikeQuestion(question)) {
      out.push({ source: sourceKey, page: cur.page, section, question, answer, index: idx++ });
    }
    cur = null;
  };

  for (const ln of lines) {
    const t = ln.text;
    if (t.length <= 24 && SECTION_CN.test(t) && !isStart(t)) { section = t; flush(); continue; }
    if (isStart(t)) {
      if (cur && sourceKey === 'a' && isAnswerEnumeration(t)) { cur.body.push(t); continue; }
      flush();
      cur = { q: t.replace(/^\d{1,3}(?:\.\d{1,2})*\.?\s*[、．.]?\s*/, ""), body: [], page: ln.page };
      continue;
    }
    if (cur) cur.body.push(t);
  }
  flush();
  return out;
}

// ---- LLM 调用 ----

const BASE = process.env.LLM_BASE_URL ?? "http://127.0.0.1:7863/v1";
const KEY = process.env.LLM_API_KEY ?? "";
const MODEL = process.env.LLM_MODEL ?? "cn:deepseek-v4.1-flash";

async function llm(messages, temperature = 0.1) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: MODEL, messages, temperature }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) {
        const d = await res.text();
        if (res.status >= 500 || /upstream_parse|EOF/i.test(d)) throw new Error(d);
        throw new Error(`LLM ${res.status}: ${d.slice(0, 200)}`);
      }
      const j = await res.json();
      const c = j.choices?.[0]?.message?.content;
      if (!c) throw new Error("empty");
      return c;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
}

function extractJson(text) {
  const f = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = f ? f[1] : text;
  const s = body.search(/[[{]/);
  if (s === -1) throw new Error("no json");
  const open = body[s], close = open === "{" ? "}" : "]";
  let d = 0, str = false, esc = false;
  for (let i = s; i < body.length; i++) {
    const ch = body[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { str = !str; continue; }
    if (str) continue;
    if (ch === open) d++;
    else if (ch === close && --d === 0) return JSON.parse(body.slice(s, i + 1));
  }
  throw new Error("incomplete json");
}

const GLYPH_RE = /[✁✂✃✄✎✲➓➔]/;

async function repairText(text) {
  if (!GLYPH_RE.test(text)) return text;
  const sys = `你是文本修复器。文本中的 ✁ ✂ ✃ ✄ ✎ ✲ ➓ ➔ 是 PDF 字体缺失产生的占位符，同一符号在不同位置可能代表不同汉字。
根据上下文推断每个占位符应是什么字，输出修复后的完整文本。
规则：只替换占位符，其余一个字都不要改；保持原换行；只输出文本，不要解释、不要代码围栏。`;
  try {
    const fixed = (await llm([{ role: "system", content: sys }, { role: "user", content: text }], 0)).trim();
    // 占位符是单个字符，「的」「建」也是单个字符，替换后长度基本不变。
    // 但模型偶尔会补标点或合并多余空格，留 25% 余量；关键是必须没有残留占位符。
    if (GLYPH_RE.test(fixed)) return text;
    if (fixed.length < text.length * 0.75 || fixed.length > text.length * 1.25) return text;
    return fixed;
  } catch { return text; }
}

const CATEGORIES = ["Java基础","集合","并发","JVM","Spring","MySQL","Redis","消息队列","分布式","微服务","网络","操作系统","数据结构与算法","设计模式","中间件","项目与架构","其他"];
const CAT_SET = new Set(CATEGORIES);

async function classifyBatch(titles) {
  const sys = `你是 Java 后端面试题库分类器。为每道题输出：
- category：只能从以下取一个 ${CATEGORIES.join(" / ")}
- tags：2-5 个技术关键词
- difficulty：1-5（1=基础常识，5=资深）
- title：规范化题目文本（去题号、补标点、不改写内容）
只输出 JSON：{"items":[{"index":0,"category":"...","tags":["..."],"difficulty":3,"title":"..."}]}`;
  const list = titles.map((t, i) => `${i}. ${t.replace(/\s+/g, " ").slice(0, 150)}`).join("\n");
  const raw = await llm([{ role: "system", content: sys }, { role: "user", content: `共 ${titles.length} 道题：\n${list}` }]);
  const parsed = extractJson(raw);
  return titles.map((t, i) => {
    const h = parsed.items?.find((x) => x.index === i);
    return {
      category: h && CAT_SET.has(h.category) ? h.category : "其他",
      tags: (h?.tags ?? []).slice(0, 5),
      difficulty: Math.min(5, Math.max(1, Math.round(h?.difficulty ?? 3))),
      title: (h?.title || t).trim(),
    };
  });
}

// ---- 并发控制 ----

async function mapLimit(items, limit, fn, onProgress) {
  const out = new Array(items.length);
  let cursor = 0, done = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        try { out[i] = await fn(items[i], i); }
        catch (e) { out[i] = null; console.error(`  item ${i} 失败: ${e.message.slice(0,80)}`); }
        done++;
        if (onProgress && done % 20 === 0) onProgress(done, items.length);
      }
    }),
  );
  return out;
}

// ---- 去重（与 src/lib/pool/dedupe.ts 同算法）----

const norm = (s) => s.replace(/\s+/g, "").replace(/[，。、；：""''？！…—\-（）()【】《》,.;:?!'"()\[\]]/g, "").toLowerCase();
const bg = (s) => { const c = norm(s), set = new Set(); for (let i = 0; i < c.length - 1; i++) set.add(c.slice(i, i + 2)); return set; };
function sim(a, b) { if (!a.size || !b.size) return 0; let n = 0; const [s, l] = a.size < b.size ? [a, b] : [b, a]; for (const g of s) if (l.has(g)) n++; return n / (a.size + b.size - n); }

function containment(a, b) { if (!a.size || !b.size) return 0; const [s, l] = a.size < b.size ? [a, b] : [b, a]; let n = 0; for (const g of s) if (l.has(g)) n++; return n / s.size; }

// 同一问题的增补式改写（如"…哪几种锁？" vs "…哪几种锁，列举一下？"）
function isDup(a, b) { return sim(a, b) >= 0.62 || containment(a, b) >= 0.85; }

// ---- 答案排版清洗（与 src/lib/pool/format.ts 同规则）----

const CJK_RE = /[一-鿿]/;
const CJK_PUNCT_RE = /[，。、；：？！（）「」『』《》…—]/;
const SENTENCE_END_RE = /[。！？；：]$/;

function cleanAnswerText(raw) {
  let t = raw.replace(/\r\n/g, "\n");
  // Powerpoint 字体的项目符号落在私用区
  t = t.replace(/[\uE000-\uF8FF]/g, "•");
  // 去掉单独成行的章节号
  t = t
    .split("\n")
    .filter((line) => !/^\d{1,2}(?:\.\d{1,2}){1,3}\.?$/.test(line.trim()))
    .map((line) => {
      const m = line.match(/^(\s*)\d{1,2}(?:\.\d{1,2}){1,3}\.?\s+(\S.*)$/);
      return m && m[2].length >= 2 ? m[1] + m[2] : line;
    })
    .join("\n");
  // 合并版面硬换行（跑两遍处理三行连成一句）
  for (let k = 0; k < 2; k++) t = mergeWraps(t);
  // 规范中文空格
  let prev = "";
  while (prev !== t) {
    prev = t;
    t = t
      .replace(/([一-鿿])[ \t]+(?=[一-鿿])/g, "$1")
      .replace(/([一-鿿])[ \t]+(?=[，。、；：？！（）「」『』《》…—])/g, "$1")
      .replace(/([，。、；：？！（）「」『』《》…—])[ \t]+(?=[一-鿿])/g, "$1");
  }
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

function mergeWraps(text) {
  const lines = text.split("\n");
  const out = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { out.push(""); continue; }
    const prevLine = out[out.length - 1];
    const canMerge =
      prevLine !== undefined && prevLine !== "" &&
      prevLine.length >= 12 &&
      !SENTENCE_END_RE.test(prevLine) &&
      (CJK_RE.test(prevLine.slice(-1)) || CJK_PUNCT_RE.test(prevLine.slice(-1))) &&
      CJK_RE.test(line[0]) &&
      !/^(\d+[.、)]|[-·•*]|[（(]\d+[)）])\s*/.test(line) &&
      !/[{};]\s*$/.test(prevLine) &&
      !/^(public|private|protected|static|class|interface|enum|abstract|package|import|@|\/\/|\/\*)/.test(line);
    if (canMerge) {
      const last = prevLine.slice(-1), first = line[0];
      const space = !CJK_RE.test(last) && !CJK_PUNCT_RE.test(last) && !CJK_PUNCT_RE.test(first) ? " " : "";
      out[out.length - 1] = prevLine + space + line;
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

function dedupe(items) {
  const sorted = [...items].sort((a, b) => (b.answer.length + b.question.length) - (a.answer.length + a.question.length));
  const buckets = new Map();
  const kept = [];
  let removed = 0;
  for (const it of sorted) {
    const g = bg(it.question);
    const key = norm(it.question).slice(0, 2);
    let merged = false;
    for (const b of [key, "**"]) {
      const list = buckets.get(b);
      if (!list) continue;
      for (const e of list) if (isDup(g, e.g)) { e.count++; removed++; merged = true; break; }
      if (merged) break;
    }
    if (!merged) {
      const e = { item: it, g, count: 0 };
      const list = buckets.get(key) ?? [];
      list.push(e); buckets.set(key, list);
      kept.push(e);
    }
  }
  return { kept: kept.map((e) => ({ ...e.item, duplicates: e.count })), removed };
}

// ---- 主流程 ----

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const limitArg = args.indexOf("--limit");

async function main() {
  // 1. 读 + 清洗 + 切题
  let all = [];
  for (const k of Object.keys(SOURCE_NAMES)) {
    const p = `data/pdftext/${k}.txt`;
    if (!fs.existsSync(p)) { console.log(`跳过 ${k}（缺 ${p}）`); continue; }
    const qs = splitQuestions(k, cleanFull(fs.readFileSync(p, "utf8")));
    console.log(`${k} ${SOURCE_NAMES[k]}: ${qs.length} 题`);
    all.push(...qs);
  }
  const limit = limitArg !== -1 ? Number(args[limitArg + 1]) : 0;
  if (limit) { all = all.slice(0, limit); console.log(`--limit 生效，仅处理 ${all.length} 题`); }

  // 2. 修字体缺字
  const broken = all.filter((q) => GLYPH_RE.test(q.question + q.answer));
  if (broken.length && !flag("--skip-repair")) {
    const p = `${STAGE}/repaired.json`;
    if (fs.existsSync(p)) {
      const cached = JSON.parse(fs.readFileSync(p, "utf8"));
      if (cached.length === all.length) { all = cached; console.log(`复用已修复结果 ${cached.length} 题`); }
    } else {
      console.log(`修复占位符：${broken.length} 题受影响，分批并发处理…`);
      const chunks = [];
      let cur = [], size = 0;
      for (const q of broken) {
        const len = q.question.length + q.answer.length;
        if (cur.length && size + len > 2500) { chunks.push(cur); cur = []; size = 0; }
        cur.push(q); size += len;
      }
      if (cur.length) chunks.push(cur);

      let done = 0;
      await mapLimit(chunks, 2, async (chunk) => {
        const text = chunk.map((q) => `### ${q.question}\n${q.answer}`).join("\n\n");
        const fixed = await repairText(text);
        const parts = fixed.split(/###\s*/).filter(Boolean);
        if (parts.length === chunk.length) {
          parts.forEach((part, i) => {
            const nl = part.indexOf("\n");
            chunk[i].question = part.slice(0, nl).trim();
            chunk[i].answer = part.slice(nl + 1).trim();
          });
        }
        done++;
        if (done % 10 === 0) console.log(`  修复 ${done}/${chunks.length} 批`);
      });
      fs.writeFileSync(p, JSON.stringify(all, null, 1));
      console.log(`修复完成，缓存到 ${p}`);
    }
  }

  // 3. 归类打标
  const clsPath = `${STAGE}/classified.json`;
  if (!flag("--skip-classify")) {
    if (fs.existsSync(clsPath)) {
      const c = JSON.parse(fs.readFileSync(clsPath, "utf8"));
      if (c.length === all.length) { console.log(`复用已分类结果 ${c.length} 条`); all = c; }
    }
    if (all[0]?.category === undefined) {
      const B = 12;
      const batches = [];
      for (let i = 0; i < all.length; i += B) batches.push(all.slice(i, i + B));
      console.log(`归类打标：${all.length} 题 / ${batches.length} 批…`);
      let done = 0;
      await mapLimit(batches, 3, async (batch) => {
        const res = await classifyBatch(batch.map((q) => q.question));
        res.forEach((r, i) => {
          batch[i].category = r.category;
          batch[i].tags = r.tags;
          batch[i].difficulty = r.difficulty;
          batch[i].title = r.title;
        });
        done++;
        if (done % 10 === 0) console.log(`  分类 ${done}/${batches.length} 批`);
      });
      fs.writeFileSync(clsPath, JSON.stringify(all, null, 1));
      console.log(`分类完成，缓存到 ${clsPath}`);
    }
  }

  // 4. 清洗答案排版（合并版面硬换行、规范空格、转项目符号）
  // 与 src/lib/pool/format.ts 的 cleanAnswer 保持一致
  for (const q of all) {
    if (q.answer) q.answer = cleanAnswerText(q.answer);
  }
  console.log("答案排版清洗完成");

  // 5. 去重
  const items = all
    .filter((q) => q.category)
    .map((q) => ({
      question: q.title ?? q.question,
      answer: q.answer,
      category: q.category,
      tags: q.tags ?? [],
      difficulty: q.difficulty ?? 3,
      sourceFile: SOURCE_NAMES[q.source] ?? q.source,
      sourceKey: q.source,
    }));
  const { kept, removed } = dedupe(items);
  console.log(`去重：${items.length} → ${kept.length}（合并 ${removed} 条相似题）`);

  const dist = {};
  for (const k of kept) dist[k.category] = (dist[k.category] || 0) + 1;
  console.log("分类分布：", JSON.stringify(dist));
  fs.writeFileSync(`${STAGE}/final.json`, JSON.stringify(kept, null, 1));

  // 5. 入库
  if (flag("--dry-run")) { console.log("--dry-run，不写库"); return; }

  const db = new Database("data/app.db");
  db.pragma("journal_mode = WAL");
  const exists = db.prepare("select name from sqlite_master where type='table' and name='questions_pool'").get();
  if (!exists) { console.error("questions_pool 表不存在，先跑 drizzle-kit migrate"); process.exit(1); }

  db.prepare("delete from questions_pool").run();
  const ins = db.prepare(
    "insert into questions_pool (id, category, tags, question, answer, difficulty, source, source_file, duplicates, created_at) values (?,?,?,?,?,?,?,?,?,?)",
  );
  const now = Math.floor(Date.now() / 1000);
  let n = 0;
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      ins.run(
        `pool-${String(++n).padStart(4, "0")}`,
        r.category,
        JSON.stringify(r.tags),
        r.question.slice(0, 500),
        r.answer,
        r.difficulty,
        "pdf-import",
        r.sourceFile,
        r.duplicates,
        now,
      );
    }
  });
  tx(kept);
  const total = db.prepare("select count(*) c from questions_pool").get().c;
  console.log(`入库完成：${total} 条`);
  db.close();
}

main().catch((e) => { console.error("失败:", e); process.exit(1); });
