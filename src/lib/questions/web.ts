/**
 * 联网召回：查询该岗位近期被问到的面试题。
 * 全部实现都失败时返回空数组，调用方降级为 LLM + 离线题库。
 */

const TIMEOUT_MS = 20_000;

type TavilyResult = { title?: string; content?: string; url?: string };

export async function searchWebQuestions(
  jobTitle: string,
  jd: string,
): Promise<string[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  return searchTavily(key, jobTitle, jd);
}

async function searchTavily(
  apiKey: string,
  jobTitle: string,
  jd: string,
): Promise<string[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: `${jobTitle} 面试题 高频 2026 面经`,
      search_depth: "basic",
      max_results: 8,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as { results?: TavilyResult[] };
  const jdKeywords = extractKeywords(jobTitle + " " + jd);

  return (data.results ?? [])
    .flatMap((r) => splitIntoSentences(r.content ?? ""))
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length <= 120)
    .filter((s) => /[?？]|如何|为什么|区别|原理|怎么|哪些/.test(s))
    .filter((s) => jdKeywords.some((k) => s.includes(k)))
    .slice(0, 25);
}

function extractKeywords(text: string): string[] {
  const STOP = new Set([
    "的", "和", "与", "或", "及", "等", "在", "对", "为", "是", "有", "能",
    "熟悉", "掌握", "了解", "精通", "负责", "要求", "优先", "具备",
  ]);
  const tokens = text.match(/[一-龥A-Za-z][一-龥A-Za-z+#.\-]{1,20}/g) ?? [];
  return [...new Set(tokens)].filter((t) => !STOP.has(t) && t.length >= 2).slice(0, 40);
}

function splitIntoSentences(text: string): string[] {
  return text.split(/[。！\n；;]/);
}
