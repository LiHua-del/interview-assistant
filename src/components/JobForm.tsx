"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Config = {
  baseMustCount: number;
  baseOptionalCount: number;
  baseReserveCount: number;
  categoryRatio: {
    实习经历: number;
    项目经历: number;
    技术基础: number;
    软素质: number;
  };
};

const DEFAULT_CONFIG: Config = {
  baseMustCount: 6,
  baseOptionalCount: 14,
  baseReserveCount: 5,
  categoryRatio: {
    实习经历: 35,
    项目经历: 35,
    技术基础: 20,
    软素质: 10,
  },
};

export function JobForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [jd, setJd] = useState("");
  const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);

  const ratioSum = Object.values(cfg.categoryRatio).reduce((a, b) => a + b, 0);
  const total = cfg.baseMustCount + cfg.baseOptionalCount;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, company, jd, questionConfig: cfg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "创建失败");
      setOpen(false);
      setTitle("");
      setCompany("");
      setJd("");
      setCfg(DEFAULT_CONFIG);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
      >
        新建岗位
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 p-4 overflow-y-auto">
      <div className="mx-auto my-8 max-w-2xl rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold">新建岗位</h2>
        <p className="mt-1 text-sm text-neutral-500">
          题单基底与评分标准挂在岗位上，同岗位所有候选人共用。
        </p>

        <div className="mt-5 space-y-4">
          <Field label="岗位名称" required>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如：后端开发工程师（校招）"
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="公司">
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="JD 原文" required>
            <textarea
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              rows={7}
              placeholder="粘贴完整岗位描述"
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm font-mono"
            />
          </Field>

          <fieldset className="rounded border border-neutral-200 p-4">
            <legend className="px-1 text-sm font-medium">题数配置</legend>
            <div className="grid grid-cols-3 gap-3">
              <Num
                label="必问"
                value={cfg.baseMustCount}
                onChange={(v) => setCfg({ ...cfg, baseMustCount: v })}
                min={3}
                max={15}
              />
              <Num
                label="选问"
                value={cfg.baseOptionalCount}
                onChange={(v) => setCfg({ ...cfg, baseOptionalCount: v })}
                min={5}
                max={40}
              />
              <Num
                label="备用"
                value={cfg.baseReserveCount}
                onChange={(v) => setCfg({ ...cfg, baseReserveCount: v })}
                min={0}
                max={20}
              />
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              必问 + 选问 = {total} 题
              {total < 10 && (
                <span className="ml-2 text-red-600">题量不足 10</span>
              )}
            </p>

            <div className="mt-4 grid grid-cols-4 gap-3">
              {(
                Object.keys(cfg.categoryRatio) as (keyof Config["categoryRatio"])[]
              ).map((k) => (
                <Num
                  key={k}
                  label={`${k}%`}
                  value={cfg.categoryRatio[k]}
                  onChange={(v) =>
                    setCfg({
                      ...cfg,
                      categoryRatio: { ...cfg.categoryRatio, [k]: v },
                    })
                  }
                  min={0}
                  max={100}
                />
              ))}
            </div>
            <p className="mt-2 text-xs">
              <span
                className={
                  ratioSum === 100 ? "text-neutral-500" : "text-red-600"
                }
              >
                占比合计 {ratioSum}%
                {ratioSum !== 100 && "（须为 100）"}
              </span>
              {cfg.categoryRatio["实习经历"] + cfg.categoryRatio["项目经历"] <
                70 && (
                <span className="ml-3 text-amber-600">
                  实习 + 项目已低于 70% 侧重目标
                </span>
              )}
            </p>
          </fieldset>

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setOpen(false)}
              className="rounded px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100"
            >
              取消
            </button>
            <button
              onClick={submit}
              disabled={busy || !title.trim() || !jd.trim() || ratioSum !== 100}
              className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy ? "创建中…" : "创建"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function Num({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-600">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
      />
    </label>
  );
}
