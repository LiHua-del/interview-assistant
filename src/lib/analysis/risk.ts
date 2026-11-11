import { askJson } from "@/lib/llm/client";
import { RISK_SCAN } from "@/lib/prompts";
import { riskFindingsSchema } from "@/lib/llm/schemas";
import type { ParsedResume, RiskFinding } from "@/lib/db/schema";

const SEVERITY_ORDER: Record<RiskFinding["severity"], number> = {
  高: 0,
  中: 1,
  低: 2,
};

export async function scanRisks(
  jd: string,
  parsed: ParsedResume,
): Promise<RiskFinding[]> {
  const findings = await askJson(
    RISK_SCAN.system,
    RISK_SCAN.user({ jd, parsed: JSON.stringify(parsed, null, 2) }),
    riskFindingsSchema,
    { temperature: 0.2, retries: 2 },
  );

  // 引用不到简历原文的可疑点直接丢弃——与题目锚点同一套防幻觉规则
  const text = JSON.stringify(parsed);
  const verified = findings.filter((f) => anchorRoughMatch(f.anchor, text));

  return verified.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

function anchorRoughMatch(anchor: string, haystack: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, "").replace(/[，。、；：""'']/g, "");
  const a = norm(anchor);
  return a.length >= 4 && norm(haystack).includes(a);
}
