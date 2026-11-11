"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CandidateUploadForm({ jobs }: { jobs: { id: string; title: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      setStep("正在解析简历…");
      const form = new FormData();
      form.append("file", file);
      if (name) form.append("name", name);

      const job = jobs.find((j) => j.id === jobId);
      if (job) {
        form.append("jd", job.title);
      }

      const res = await fetch("/api/candidates", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "解析失败");

      setStep("解析完成");
      setOpen(false);
      setFile(null);
      setName("");
      router.push(`/candidates/${data.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "解析失败");
    } finally {
      setBusy(false);
      setStep("");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
      >
        上传简历
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 p-4 overflow-y-auto">
      <div className="mx-auto my-8 max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold">上传简历</h2>
        <p className="mt-1 text-sm text-neutral-500">
          支持 PDF（文字版）与 Markdown。扫描件无法解析，会明确报错。
        </p>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              简历文件<span className="ml-0.5 text-red-500">*</span>
            </span>
            <input
              type="file"
              accept=".pdf,.md,.markdown"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-neutral-100 file:px-3 file:py-1 file:text-sm"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">姓名</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="留空则从简历中识别"
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">关联岗位</span>
            <select
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="">不关联（稍后选择）</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
          </label>

          {step && (
            <p className="rounded bg-blue-50 px-3 py-2 text-sm text-blue-700">
              {step}
            </p>
          )}
          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setOpen(false)}
              disabled={busy}
              className="rounded px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100"
            >
              取消
            </button>
            <button
              onClick={submit}
              disabled={busy || !file}
              className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy ? "处理中…" : "上传并解析"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
