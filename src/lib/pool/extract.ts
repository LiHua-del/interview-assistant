/**
 * 面试题 PDF 的清洗与切题规则层。
 *
 * 四份来源的排版差异很大，不能用一个正则套所有：
 *  - a（1000道 485页）：中文逐字空格，题号 "12、"，目录带 "..." 引导
 *  - b（JAVA核心知识整理）：标题式 "4.1.5.1 终止线程"，只有少量问句
 *  - c（大厂后端面筋指南）：编号 "1.60"，题目常以问号结尾，带残留页码
 *  - d（周瑜 66页）：有康熙部首异体字（⼀→一），题与题之间无编号、靠换行
 *
 * 因此清洗先统一字符层问题，再按来源选择切题策略。
 */

// ---------- 字符层清洗 ----------

// 康熙部首 / CJK 部首区（U+2F00-2FDF）映射到常用汉字
const RADICALS: Record<string, string> = {
  "⼀": "一", "⼁": "丨", "⼂": "丶", "⼃": "丿", "⼄": "乙", "⼆": "二",
  "⼈": "人", "⼉": "儿", "⼊": "入", "⼋": "八", "⼏": "几", "⼑": "刀",
  "⼒": "力", "⼗": "十", "⼙": "卩", "⼚": "厂", "⼜": "又", "⼝": "口",
  "⼟": "土", "⼤": "大", "⼥": "女", "⼦": "子", "⼧": "宀", "⼨": "寸",
  "⼩": "小", "⼫": "尸", "⼭": "山", "⼯": "工", "⼰": "己", "⼱": "巾",
  "⼲": "干", "⼴": "广", "⼸": "弓", "⼹": "彐", "⼼": "心", "⼽": "戈",
  "⼾": "户", "⼿": "手", "⽀": "支", "⽂": "文", "⽃": "斗", "⽄": "斤",
  "⽅": "方", "⽆": "无", "⽇": "日", "⽈": "曰", "⽉": "月", "⽊": "木",
  "⽋": "欠", "⽌": "止", "⽎": "殳", "⽐": "比", "⽑": "毛", "⽒": "氏",
  "⽓": "气", "⽔": "水", "⽕": "火", "⽗": "父", "⽚": "片", "⽛": "牙",
  "⽜": "牛", "⽝": "犬", "⽟": "玉", "⽣": "生", "⽤": "用", "⽥": "田",
  "⽩": "白", "⽪": "皮", "⽫": "皿", "⽬": "目", "⽮": "矢", "⽯": "石",
  "⽰": "示", "⽲": "禾", "⽳": "穴", "⽴": "立", "⽵": "竹", "⽶": "米",
  "⽹": "网", "⽺": "羊", "⽻": "羽", "⽼": "老", "⽽": "而", "⽿": "耳",
  "⾁": "肉", "⾃": "自", "⾄": "至", "⾆": "舌", "⾈": "舟", "⾊": "色",
  "⾍": "虫", "⾎": "血", "⾏": "行", "⾐": "衣", "⾓": "角", "⾔": "言",
  "⾕": "谷", "⾖": "豆", "⾛": "走", "⾜": "足", "⾝": "身", "⾞": "车",
  "⾟": "辛", "⾠": "辰", "⾢": "邑", "⾥": "里", "⾦": "金", "⾨": "门",
  "⾪": "隶", "⾬": "雨", "⾮": "非", "⾯": "面", "⾰": "革", "⾳": "音",
  "⾴": "页", "⾵": "风", "⾶": "飞", "⾷": "食", "⾸": "首", "⾺": "马",
  "⾻": "骨", "⾼": "高", "⿂": "鱼", "⿃": "鸟", "⿅": "鹿", "⿊": "黑",
  "⿏": "鼠", "⿐": "鼻", "⿒": "齿", "⿓": "龙",
};

export function normalizeChars(text: string): string {
  let t = text;

  // 康熙部首 → 常用字
  t = t.replace(/[⼀-⿟]/g, (c) => RADICALS[c] ?? c);

  // a 的中文逐字空格："可 以 看 到" → "可以看到"（跑两遍处理连续情况）
  for (let i = 0; i < 3; i++) {
    t = t.replace(/([一-鿿]) +(?=[一-鿿])/g, "$1");
  }

  // 全角数字/字母 → 半角
  t = t.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );

  return t;
}

/** 去掉页眉、页脚、页码、目录行等噪声 */
export function stripNoise(text: string): string {
  return text
    .replace(/^第\s*\d+\s*页\s*共\s*\d+\s*页\s*$/gm, "")
    .replace(/^\d{2}\/\d{2}\/\d{4}\s+Page\s+\d+\s+of\s+\d+\s*$/gm, "")
    .replace(/^<<<PAGE \d+>>>$/gm, "")
    // 目录行：带 4 个以上点或 2 个以上省略号并跟页码
    .replace(/^.*?\.{4,}\s*\d+\s*$/gm, "")
    .replace(/^.*?…{2,}\s*\d+\s*$/gm, "")
    // 纯页码 / 纯序号行
    .replace(/^\s*\d{1,4}\s*$/gm, "")
    // 行尾残留的分页页码（c 里 6x 常见）
    .replace(/([？?。！!])\s+\d{1,3}\s*$/gm, "$1")
    .replace(/\n{3,}/g, "\n\n");
}

export function cleanFull(text: string): string {
  return stripNoise(normalizeChars(text));
}

// ---------- 切题 ----------

export type RawQuestion = {
  source: string;
  page: number;
  section: string;
  question: string;
  answer: string;
  index: number;
};

/**
 * 题目的最终形态校验。
 *
 * 切题只能保证"这里像新题的开头"，但答案里被错误断行的陈述句
 * （如 "提供映射标签，支持对象与数据库的 ORM 字段关系映射"）也会通过。
 * 真正的面试题要么是问句，要么是名词性标题（b 就整本都是标题式）。
 */
function looksLikeQuestion(q: string): boolean {
  // 问句
  if (/[？?]\s*$/.test(q)) return true;
  // 含疑问/请求特征词
  if (/(什么|为什么|如何|怎么|哪些|是否|区别|原理|谈谈|说说|简述|请|解释|描述|比较|介绍)/.test(q))
    return true;
  // 标题式：短、无句末标点、不含"的/了/是"这类陈述句常用字的高频组合
  if (q.length <= 30 && !/[。；;]/.test(q)) {
    const declarativeHits = (q.match(/(提供|支持|包括|由于|因此|从而|可以|需要|具有)/g) ?? []).length;
    if (declarativeHits <= 1) return true;
  }
  return false;
}

type Line = { text: string; page: number };

function toLines(cleaned: string, pageMap: Map<number, number>): Line[] {
  const out: Line[] = [];
  let page = 1;
  for (const raw of cleaned.split("\n")) {
    const m = raw.match(/^<<<PAGE (\d+)>>>$/);
    if (m) {
      page = Number(m[1]);
      continue;
    }
    const t = raw.trim();
    if (!t) continue;
    out.push({ text: t, page: pageMap.get(page) ?? page });
  }
  return out;
}

/** 判断一行是否是题目起始 */
function isQuestionStart(line: string, style: SourceStyle): boolean {
  const t = line.trim();
  if (t.length < 4) return false;

  if (style.patterns.some((re) => re.test(t))) return true;

  // 问句结尾，但排除明显的正文短句
  if (/[？?]\s*$/.test(t) && t.length >= 8 && t.length <= 120) return true;

  return false;
}

/**
 * 答案内部的枚举行：以 "1、2、3、" 或 "（1）" 开头，且不以问号结尾。
 *
 * 区分"题号"与"答案里的列表项"是这类 PDF 最容易出错的地方：
 * 例如 MyBatis 优点的答案里写 "1、基于 SQL 语句编程… 2、提供映射标签…"，
 * 若不排除，每一条都会变成一道假题目。
 *
 * 判据：真正的题号通常整行较短、以问号或"是什么/为什么"这类结构结尾；
 * 而列表项是陈述句，且紧跟在已有题目的答案之后。
 */
function isAnswerEnumeration(t: string): boolean {
  if (!/^\d{1,2}\s*[、．.]\s*\S{2,}/.test(t)) return false;
  // 以问号结尾的仍视为题目
  if (/[？?]\s*$/.test(t)) return false;
  // 含明显的题目特征词
  if (/(什么|为什么|如何|怎么|哪些|是否|区别|原理|谈谈|说说|简述|请)/.test(t)) return false;
  return true;
}

export type SourceStyle = {
  /** 题号正则（不含捕获组外的判断） */
  patterns: RegExp[];
  /** 是否把编号后的同段文字当作完整题目 */
  keepNumber: boolean;
};

export const STYLES: Record<string, SourceStyle> = {
  // "12、" / "12." / "12 ." 中文题号
  numCn: {
    patterns: [/^\d{1,3}\s*[、．.]\s*\S{2,}/],
    keepNumber: false,
  },
  // "4.1.5. 终止线程 4 种方式" / "4.1.5.1. 正常运行结束" 标题式编号
  numMulti: {
    patterns: [
      /^\d{1,2}(?:\.\d{1,2}){1,3}\.\s*\S{2,}/, // 4.1.5. 标题
      /^\d{1,2}(?:\.\d{1,2}){1,3}\s+\S{2,}/, // 4.1.5 标题
    ],
    keepNumber: false,
  },
  // "1.60 关心过业务系统..." 章节题号
  numTwo: {
    patterns: [/^\d{1,2}\.\d{1,2}\s+\S{2,}/],
    keepNumber: false,
  },
  // d：无编号，只靠问号
  markOnly: {
    patterns: [],
    keepNumber: false,
  },
};

const SECTION_RE = /^(第[一二三四五六七八九十]+[章节]|[一二三四五六七八九十]+[、.]|\d{1,2}[、.]\s*[一-鿿]{2,12}$)/;
const SECTION_CN = /^(Java|JVM|MySQL|Redis|Spring|并发|多线程|集合|设计模式|消息队列|分布式|微服务|网络|操作系统|数据结构|算法|数据库|Zookeeper|Kafka|Dubbo|Netty|Tomcat|Mybatis|Hibernate|Linux|Git|Maven|基础|综合)/i;

export function splitQuestions(
  sourceKey: string,
  cleaned: string,
  style: SourceStyle,
): RawQuestion[] {
  const lines = toLines(cleaned, new Map());
  const result: RawQuestion[] = [];

  let section = "";
  let cur: { q: string; body: string[]; page: number } | null = null;
  let idx = 0;

  const flush = () => {
    if (!cur) return;
    const answer = cur.body.join("\n").trim();
    const question = cur.q.trim();
    if (
      question.length >= 6 &&
      question.length <= 200 &&
      answer.length >= 10 &&
      !/^\.{3,}/.test(question) &&
      looksLikeQuestion(question)
    ) {
      result.push({
        source: sourceKey,
        page: cur.page,
        section,
        question,
        answer,
        index: idx++,
      });
    }
    cur = null;
  };

  for (const ln of lines) {
    const t = ln.text;

    // 章节标题（短行 + 命中章节特征）
    if (t.length <= 24 && SECTION_CN.test(t) && !isQuestionStart(t, style)) {
      section = t.replace(/^\d+[、.]?\s*/, "");
      flush();
      continue;
    }
    if (SECTION_RE.test(t) && t.length <= 24) {
      section = t;
      flush();
      continue;
    }

    if (isQuestionStart(t, style)) {
      // 已在一道题的答案内部时，形如 "2、xxx" 的陈述句多半是答案列表项
      // 只有「中文式单级题号」的来源才需要区分题号与答案列表
      if (cur && style === STYLES.numCn && isAnswerEnumeration(t)) {
        cur.body.push(t);
        continue;
      }
      flush();
      const q = style.keepNumber ? t : t.replace(/^\d{1,3}(?:\.\d{1,2})*\s*[、．.]?\s*/, "");
      cur = { q, body: [], page: ln.page };
      continue;
    }

    if (cur) {
      // 连续的代码块、列表都并入答案
      cur.body.push(t);
    }
  }
  flush();

  return result;
}

/** 按来源挑选切题策略 */
export function styleFor(sourceKey: string): SourceStyle {
  switch (sourceKey) {
    case "a":
      return STYLES.numCn;
    case "b":
      return STYLES.numMulti;
    case "c":
      return STYLES.numTwo;
    case "d":
      return STYLES.markOnly;
    default:
      return STYLES.numCn;
  }
}
