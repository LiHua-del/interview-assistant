"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 删除按钮 + 二次确认。
 * 删除是不可逆操作，必须让用户明确看到要删的是哪个对象。
 */
export function DeleteButton({
  endpoint,
  name,
  label = "删除",
  warning,
  redirectTo,
  size = "sm",
  disabled = false,
  onDeleted,
}: {
  endpoint: string;
  /** 要删除的对象名称，显示在确认框里 */
  name: string;
  label?: string;
  /** 额外风险提示，如会连带删除多少记录 */
  warning?: string;
  /** 删除成功后跳转的路径 */
  redirectTo?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmText, setConfirmText] = useState("");

  async function doDelete() {
    if (disabled || busy || confirmText.trim() !== name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(endpoint, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "删除失败");
      setOpen(false);
      onDeleted?.();
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setError("");
          setConfirmText("");
          setOpen(true);
        }}
        className={`rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 ${
          size === "sm" ? "px-2 py-1 text-xs" : "px-4 py-2 text-sm"
        }`}
      >
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!busy) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`确认删除${name}`}
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-red-700">确认删除</h3>
            <p className="mt-2 text-sm text-neutral-700">
              即将删除 <span className="font-medium">{name}</span>，此操作不可恢复。
            </p>
            {warning && (
              <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {warning}
              </p>
            )}

            <label className="mt-4 block">
              <span className="mb-1 block text-xs text-neutral-600">
                输入对象名称以确认
              </span>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={name}
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            </label>

            {error && (
              <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100"
              >
                取消
              </button>
              <button
                onClick={doDelete}
                disabled={disabled || busy || confirmText.trim() !== name.trim()}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy ? "删除中…" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
