import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { candidates, questionSets, jobs } from "@/lib/db/schema";
import { loadResumeDocument } from "@/lib/resume/parse";
import { InterviewWorkspace } from "@/components/InterviewWorkspace";

export const dynamic = "force-dynamic";

export default async function InterviewPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ setId?: string }>;
}) {
  const { id } = await params;
  const { setId } = await searchParams;
  const candidate = db.select().from(candidates).where(eq(candidates.id, id)).get();
  if (!candidate) notFound();
  const sets = db.select().from(questionSets).where(eq(questionSets.candidateId, id)).orderBy(desc(questionSets.createdAt)).all();
  const selected = setId ? sets.find((set) => set.id === setId) : sets[0];
  if (setId && !selected) notFound();
  const allJobs = db.select().from(jobs).all();
  const document = await loadResumeDocument(candidate);
  return <InterviewWorkspace
    key={selected?.id ?? id}
    candidate={{ id, name: candidate.name, hasOriginal: !!candidate.resumeFile, format: candidate.resumeFormat }}
    document={document}
    questions={selected?.questions ?? []}
    expectedLevels={selected?.configSnapshot?.candidate?.followupLevels}
    selectedSetId={selected?.id ?? ""}
    sets={sets.map((set) => ({ id: set.id, label: `${allJobs.find((job) => job.id === set.jobId)?.title ?? "未知岗位"} · ${new Date(set.createdAt * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · ${set.questions.length}题` }))}
  />;
}
