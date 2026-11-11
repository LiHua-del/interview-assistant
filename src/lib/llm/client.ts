import { z } from "zod";

const BASE_URL = process.env.LLM_BASE_URL ?? "http://127.0.0.1:7863/v1";
const API_KEY = process.env.LLM_API_KEY ?? "";
const MODEL = process.env.LLM_MODEL ?? "cn:deepseek-v4.1-flash";

export class LLMError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * 上游偶发 502 / unexpected EOF，属于可重试的传输错误。
 * 这类错误不改变语义，退避重试即可，不需要回喂模型。
 */
class RetryableError extends Error {}

async function chat(messages: ChatMessage[], temperature = 0.3): Promise<string> {
  let lastErr: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await chatOnce(messages, temperature);
    } catch (err) {
      lastErr = err;
      if (!(err instanceof RetryableError)) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function chatOnce(
  messages: ChatMessage[],
  temperature: number,
): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages, temperature }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    // 502/503/504 与 upstream_parse 都是上游传输问题
    if (res.status >= 500 || /upstream_parse|EOF|timeout/i.test(detail)) {
      throw new RetryableError(`LLM 上游错误 (${res.status})：${detail}`);
    }
    throw new LLMError(`LLM 请求失败 (${res.status})`, detail);
  }

  const raw = await res.text();
  let data: { choices?: { message?: { content?: string } }[] };
  try {
    data = JSON.parse(raw);
  } catch {
    // 流被截断时会拿到不完整 JSON
    throw new RetryableError("LLM 响应不完整（可能输出被截断）");
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new RetryableError("LLM 返回内容为空");
  }
  return content;
}

/**
 * 从可能带 markdown 围栏或前后废话的回复里抠出第一个完整 JSON 值。
 * 若输出被截断，尝试补齐未闭合的括号与字符串——模型在长度上限处
 * 常把 JSON 切在半路，直接丢弃会浪费一整题。
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;

  const start = body.search(/[[{]/);
  if (start === -1) throw new LLMError("回复中未找到 JSON");

  const open = body[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastComplete = -1;

  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        lastComplete = i;
        break;
      }
    }
  }

  if (lastComplete !== -1) {
    return JSON.parse(body.slice(start, lastComplete + 1));
  }

  // 截断修复：去掉尾部未完成的片段，补齐括号
  const repaired = repairTruncated(body.slice(start), open, close);
  if (repaired) {
    try {
      return JSON.parse(repaired);
    } catch {
      /* 落到下方抛错 */
    }
  }
  throw new LLMError("JSON 结构不完整");
}

function repairTruncated(
  fragment: string,
  open: string,
  close: string,
): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let lastSafe = -1;

  for (let i = 0; i < fragment.length; i++) {
    const ch = fragment[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) depth--;
    // 记录处于"值刚结束"的安全位置
    else if (ch === "," && depth >= 1) lastSafe = i;
  }

  if (lastSafe <= 0) return null;

  let s = fragment.slice(0, lastSafe);
  // 重新统计需要补多少层
  let d = 0;
  let str = false;
  let esc = false;
  for (const ch of s) {
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') {
      str = !str;
      continue;
    }
    if (str) continue;
    if (ch === open) d++;
    else if (ch === close) d--;
  }
  if (str) s += '"';
  s += close.repeat(Math.max(0, d));
  return s;
}

/**
 * 让 LLM 输出符合 schema 的结构化结果。
 * 校验失败时把错误回喂给模型重试一次。
 */
export async function askJson<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  opts: {
    temperature?: number;
    retries?: number;
    /** schema 校验前先做字段归一化，应对模型输出字段名不稳定的问题 */
    preprocess?: (raw: unknown) => unknown;
  } = {},
): Promise<T> {
  const { temperature = 0.3, retries = 1, preprocess } = opts;
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    {
      role: "user",
      content: `${user}\n\n———\n只输出一个 JSON 值，不要 markdown 代码围栏、不要标题、不要任何解释文字。`,
    },
  ];

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = await chat(messages, temperature);
    try {
      const json = extractJson(raw);
      const parsed = schema.parse(preprocess ? preprocess(json) : json);
      return parsed;
    } catch (err) {
      lastErr = err;
      const detail = err instanceof Error ? err.message : String(err);
      console.error(
        `[llm] 第 ${attempt + 1} 次解析失败（返回 ${raw.length} 字符）：${detail.slice(0, 200)}`,
      );
      console.error(`[llm] 返回开头：${raw.slice(0, 160).replace(/\n/g, " ")}`);
      // 每次重试从干净历史重建，且只带最近一次的纠正，避免上下文膨胀
      messages.length = 2;
      messages.push({ role: "assistant", content: raw.slice(0, 3000) });
      messages.push({
        role: "user",
        content: `上一次输出无法解析：${detail.slice(0, 400)}\n请只输出符合要求的 JSON，不要任何解释文字、不要 markdown 标题。`,
      });
    }
  }
  throw new LLMError(
    "LLM 输出未通过 schema 校验",
    lastErr instanceof Error ? lastErr.message.slice(0, 500) : undefined,
  );
}

export async function askText(
  system: string,
  user: string,
  temperature = 0.4,
): Promise<string> {
  return chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
  );
}
