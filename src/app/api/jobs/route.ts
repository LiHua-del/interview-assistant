import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import {
  DEFAULT_JOB_CONFIG,
  validateJobConfig,
} from "@/lib/questions/generate";
import type { JobQuestionConfig, RubricDimension } from "@/lib/db/schema";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      title?: string;
      company?: string;
      jd?: string;
      rubric?: RubricDimension[];
      questionConfig?: JobQuestionConfig;
    };

    if (!body.title?.trim() || !body.jd?.trim()) {
      return NextResponse.json({ error: "岗位名称和 JD 必填" }, { status: 400 });
    }

    const config = { ...DEFAULT_JOB_CONFIG, ...body.questionConfig };
    const errors = validateJobConfig(config).filter(
      // 「占比低于 70%」是提示不是错误，不阻止保存
      (e) => !e.includes("已低于 70%"),
    );
    if (errors.length) {
      return NextResponse.json(
        { error: `题数配置有误：${errors.join("；")}` },
        { status: 422 },
      );
    }

    const id = randomUUID();
    db.insert(jobs)
      .values({
        id,
        title: body.title.trim(),
        company: body.company?.trim() || null,
        jdSnapshot: body.jd.trim(),
        rubric: body.rubric?.length ? body.rubric : DEFAULT_RUBRIC,
        questionConfig: config,
      })
      .run();

    return NextResponse.json({ id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "创建岗位失败" },
      { status: 500 },
    );
  }
}

export const DEFAULT_RUBRIC: RubricDimension[] = [
  { key: "tech_depth", name: "技术深度", weight: 30, description: "原理理解与边界认知" },
  { key: "problem_solving", name: "问题解决", weight: 25, description: "拆解、权衡与落地" },
  { key: "authenticity", name: "项目真实性", weight: 20, description: "细节可复现、经得起追问" },
  { key: "communication", name: "沟通表达", weight: 15, description: "结构清晰、重点突出" },
  { key: "fit", name: "岗位匹配", weight: 10, description: "技术栈与业务方向契合" },
];
