import { db } from "@/lib/db";
import { questionsPool } from "@/lib/db/schema";

const MAX_POOL_HITS = 20;

/**
 * 从离线题库按岗位关键词挑候选题。
 * 题库为空时返回空数组（不报错），出题仍可依赖 LLM。
 *
 * 打分同时看题目、标签、分类和答案摘要：
 * 只看题目会漏掉"这个问题在答案里才提到 Kafka"的情况。
 */
export function pickPoolQuestions(
  jobTitle: string,
  jd: string,
): { question: string; category: string; difficulty: number; answer: string }[] {
  const keywords = extractKeywords(`${jobTitle} ${jd}`);
  if (!keywords.length) return [];

  const rows = db.select().from(questionsPool).all();

  const scored = rows
    .map((r) => {
      const head = `${r.question} ${r.tags.join(" ")} ${r.category}`;
      const body = r.answer.slice(0, 600);
      let hits = 0;
      for (const k of keywords) {
        if (head.includes(k)) hits += 2; // 题目/标签命中权重更高
        else if (body.includes(k)) hits += 1;
      }
      // 收藏表示"我实际会考"，同分时优先
      return { row: r, hits, fav: r.favorite ? 1 : 0 };
    })
    .filter((x) => x.hits >= 2)
    .sort(
      (a, b) =>
        b.hits - a.hits ||
        b.fav - a.fav ||
        b.row.difficulty - a.row.difficulty,
    )
    .slice(0, MAX_POOL_HITS);

  return scored.map(({ row }) => ({
    question: row.question,
    category: row.category,
    difficulty: row.difficulty,
    answer: row.answer,
  }));
}

/** 技术词表：优先匹配 JD 中出现的具体技术名 */
const TECH_TERMS = [
  "Java", "Go", "Golang", "Python", "C++", "Rust", "Kotlin", "Scala",
  "Spring Boot", "Spring Cloud", "Spring", "MyBatis", "Hibernate", "Netty",
  "Dubbo", "Kafka", "RocketMQ", "RabbitMQ", "Pulsar", "ActiveMQ",
  "Redis", "Memcached", "MongoDB", "Elasticsearch", "MySQL", "PostgreSQL",
  "Oracle", "SQL", "Zookeeper", "Nacos", "Seata", "Sentinel", "Hystrix",
  "Docker", "Kubernetes", "K8s", "Istio", "Prometheus", "Grafana",
  "JVM", "GC", "多线程", "并发", "线程池", "锁", "集合", "HashMap",
  "ConcurrentHashMap", "AQS", "ThreadLocal", "JUC",
  "分布式", "微服务", "高并发", "负载均衡", "缓存", "消息队列", "事务",
  "索引", "分库分表", "限流", "熔断", "幂等", "Linux", "TCP", "HTTP",
  "设计模式", "算法", "数据结构", "垃圾回收", "类加载", "序列化",
];

/**
 * 从岗位标题与 JD 中抽取关键词。
 *
 * 直接用正则切词会把"参与线上问题排查与系统稳定性建设"整句当成一个词，
 * 导致匹配退化为随机命中。这里改为：先扫描技术词表，再补充 JD 里的
 * 短英文/数字标识（如 DDD、TiDB），最后才用切词兜底。
 */
function extractKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];

  for (const term of TECH_TERMS) {
    if (lower.includes(term.toLowerCase())) found.push(term);
  }

  // JD 里出现的其他英文技术标识（2-15 字符，允许 + # . -）
  const english = text.match(/\b[A-Za-z][A-Za-z0-9+#.\-]{1,14}\b/g) ?? [];
  const ENGLISH_STOP = new Set([
    "and", "or", "the", "with", "for", "you", "are", "will", "our", "team",
    "company", "job", "role", "must", "have", "has", "can", "able",
  ]);
  for (const w of english) {
    const t = w.trim();
    if (t.length >= 2 && !ENGLISH_STOP.has(t.toLowerCase())) found.push(t);
  }

  // 中文兜底：只取 2-6 字的短词，避免整句进入
  const cn = text.match(/[一-龥]{2,6}/g) ?? [];
  const CN_STOP = new Set([
    "岗位职责", "任职要求", "工作职责", "职位描述", "负责", "参与", "熟悉",
    "掌握", "了解", "精通", "优先", "具备", "以上", "相关", "能力", "经验",
    "系统", "业务", "公司", "团队", "要求", "职责", "开发", "建设", "设计",
  ]);
  for (const w of cn) {
    if (!CN_STOP.has(w) && w.length >= 2) found.push(w);
  }

  return [...new Set(found)].slice(0, 60);
}
