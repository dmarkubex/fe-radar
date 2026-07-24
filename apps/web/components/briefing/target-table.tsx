"use client";

import { useCallback, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TargetForm } from "./target-form";

interface TargetRow {
  id: number;
  name: string;
  channel: string;
  webhookUrl: string;
  signSecret: string | null;
  enabled: boolean;
  createdAt: string | null;
}

interface DeleteModalProps {
  target: TargetRow;
  onConfirm(): void;
  onCancel(): void;
}

function DeleteModal({ target, onConfirm, onCancel }: DeleteModalProps): React.JSX.Element {
  const [inputValue, setInputValue] = useState("");
  const matches = inputValue === target.name;

  return (
    <Dialog
      ariaLabel="确认删除推送目标"
      onClose={onCancel}
      open
      panelClassName="w-full max-w-md border border-border bg-surface p-6 shadow-pop"
    >
      <h3 className="font-display text-base font-semibold text-danger">
        确认删除推送目标
      </h3>
      <p className="mt-2 text-sm text-fg-muted">
        此操作不可撤销。推送目标将被软删除（disabled_at 标记）。
      </p>
      <p className="mt-3 text-sm text-fg">
        请输入目标名称{" "}
        <span className="font-mono font-semibold text-fg">
          &ldquo;{target.name}&rdquo;
        </span>{" "}
        以确认删除：
      </p>
      <input
        className="mt-2 h-11 w-full border border-border bg-bg px-3 text-sm text-fg placeholder:text-fg-soft focus:border-accent focus:outline-none"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder={target.name}
        aria-label="输入目标名称确认删除"
        data-testid="delete-confirm-input"
      />
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={!matches}
          className="min-h-11 flex-1 border border-danger bg-danger py-2 font-mono text-xs uppercase tracking-wide text-bg transition-colors hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="delete-confirm-btn"
        >
          确认删除
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 border border-border bg-surface px-4 py-2 font-mono text-xs uppercase tracking-wide text-fg-muted transition-colors hover:bg-bg-deep"
        >
          取消
        </button>
      </div>
    </Dialog>
  );
}

interface ToastMessage {
  id: number;
  ok: boolean;
  text: string;
}

let toastCounter = 0;

export function TargetTable(): React.JSX.Element {
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingTarget, setEditingTarget] = useState<TargetRow | null>(null);
  const [deletingTarget, setDeletingTarget] = useState<TargetRow | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [showForm, setShowForm] = useState(false);

  function addToast(ok: boolean, text: string): void {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, ok, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }

  const loadRows = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/briefing/targets", { cache: "no-store" });
      if (!response.ok) throw new Error("推送目标加载失败");
      const payload = (await response.json()) as { items: TargetRow[] };
      setRows(payload.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  async function toggleEnabled(row: TargetRow): Promise<void> {
    try {
      const response = await fetch(`/api/briefing/targets/${row.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !row.enabled })
      });
      if (!response.ok) throw new Error("更新状态失败");
      await loadRows();
    } catch (cause) {
      addToast(false, cause instanceof Error ? cause.message : "更新状态失败");
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deletingTarget) return;
    try {
      const response = await fetch(`/api/briefing/targets/${deletingTarget.id}`, {
        method: "DELETE"
      });
      if (!response.ok) throw new Error("删除失败");
      setDeletingTarget(null);
      await loadRows();
    } catch (cause) {
      addToast(false, cause instanceof Error ? cause.message : "删除失败");
    }
  }

  async function testPush(row: TargetRow): Promise<void> {
    setTestingId(row.id);
    try {
      const response = await fetch(`/api/briefing/targets/${row.id}/test`, { method: "POST" });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        addToast(true, `「${row.name}」测试推送成功`);
      } else {
        addToast(false, `「${row.name}」测试推送失败：${data.error ?? "未知错误"}`);
      }
    } catch (cause) {
      addToast(false, `「${row.name}」推送请求异常：${cause instanceof Error ? cause.message : "未知错误"}`);
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* ---- Toast notifications ---- */}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`border px-4 py-3 font-mono text-xs shadow-card ${
              toast.ok
                ? "border-ok bg-ok/10 text-ok"
                : "border-danger bg-danger/10 text-danger"
            }`}
          >
            {toast.text}
          </div>
        ))}
      </div>

      {/* ---- Delete confirm modal ---- */}
      {deletingTarget ? (
        <DeleteModal
          target={deletingTarget}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeletingTarget(null)}
        />
      ) : null}

      {/* ---- Edit form modal ---- */}
      {editingTarget ? (
        <Dialog
          ariaLabel={`编辑推送目标 ${editingTarget.name}`}
          onClose={() => setEditingTarget(null)}
          open
          panelClassName="w-full max-w-md border border-border bg-surface-warm p-6 shadow-pop"
        >
          <TargetForm
            initial={editingTarget}
            onSaved={() => {
              setEditingTarget(null);
              void loadRows();
            }}
            onCancel={() => setEditingTarget(null)}
          />
        </Dialog>
      ) : null}

      {/* ---- 2-column: table + new form ---- */}
      <section className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* left: target table */}
        <div className="panel-surface">
          <div className="flex items-baseline justify-between border-b border-hairline px-6 py-4">
            <h3 className="font-display text-base font-semibold text-fg">
              推送目标列表
            </h3>
            <span className="font-mono text-[11px] text-fg-soft">
              {rows.length} 条
            </span>
          </div>
          <div className="overflow-x-auto">
            {error ? (
              <p className="px-6 py-4 font-mono text-sm text-danger" role="alert">{error}</p>
            ) : null}
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="px-6 py-3 eyebrow">ID</th>
                  <th className="px-3 py-3 eyebrow">名称</th>
                  <th className="px-3 py-3 eyebrow">渠道</th>
                  <th className="px-3 py-3 eyebrow">Webhook URL</th>
                  <th className="px-3 py-3 eyebrow">密钥</th>
                  <th className="px-3 py-3 eyebrow">状态</th>
                  <th className="px-3 py-3 eyebrow">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.length === 0 ? (
                  <tr>
                    <td className="px-6 py-8 text-fg-muted" colSpan={7}>
                      暂无推送目标，请在右侧新增。
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      data-testid={`target-row-${row.id}`}
                      className="transition-colors hover:bg-bg-deep"
                    >
                      <td className="px-6 py-3 font-mono text-xs tabular-nums text-fg-soft">
                        {row.id}
                      </td>
                      <td className="px-3 py-3 font-medium text-fg">{row.name}</td>
                      <td className="px-3 py-3 font-mono text-xs text-fg-muted">{row.channel}</td>
                      <td className="max-w-[160px] truncate px-3 py-3 font-mono text-xs text-fg-muted">
                        {row.webhookUrl}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-fg-muted">
                        {row.signSecret ? "••••••••" : "—"}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`font-mono text-xs ${row.enabled ? "text-ok" : "text-fg-soft"}`}>
                          {row.enabled ? "启用" : "停用"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            className="rounded-none px-2 py-1 font-mono text-[11px] text-accent hover:bg-accent/10"
                            onClick={() => setEditingTarget(row)}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className={`rounded-none px-2 py-1 font-mono text-[11px] hover:bg-bg-deep ${
                              row.enabled ? "text-warn" : "text-ok"
                            }`}
                            onClick={() => void toggleEnabled(row)}
                          >
                            {row.enabled ? "停用" : "启用"}
                          </button>
                          <button
                            type="button"
                            disabled={testingId === row.id}
                            className="rounded-none px-2 py-1 font-mono text-[11px] text-accent hover:bg-accent/10 disabled:opacity-50"
                            onClick={() => void testPush(row)}
                            data-testid={`test-push-${row.id}`}
                          >
                            {testingId === row.id ? "推送中…" : "测试推送"}
                          </button>
                          <button
                            type="button"
                            className="rounded-none px-2 py-1 font-mono text-[11px] text-danger hover:bg-danger/10"
                            onClick={() => setDeletingTarget(row)}
                            data-testid={`delete-btn-${row.id}`}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* right: add form */}
        <div className="border border-border bg-surface-warm p-6 shadow-card">
          {showForm ? (
            <TargetForm
              onSaved={() => {
                setShowForm(false);
                void loadRows();
              }}
              onCancel={() => setShowForm(false)}
            />
          ) : (
            <div className="space-y-4">
              <h3 className="font-display text-base font-semibold text-fg">新增推送目标</h3>
              <p className="font-mono text-[11px] text-fg-soft">
                点击下方按钮开始新增钉钉群机器人推送目标。
              </p>
              <Button
                type="button"
                onClick={() => setShowForm(true)}
                className="w-full"
                variant="accent"
              >
                新建推送目标
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
