"use client";

import { useState } from "react";
import { BrainCircuit, ExternalLink } from "lucide-react";

type MirofishResponse = {
  projectUrl?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

export function MirofishPredictionButton({
  itemId,
  className = ""
}: {
  itemId: number;
  className?: string;
}): React.JSX.Element {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [requirement, setRequirement] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/items/${itemId}/mirofish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirement: requirement.trim() })
      });
      const payload = (await response.json().catch(() => ({}))) as MirofishResponse;
      if (!response.ok || !payload.projectUrl) {
        setMessage(payload.error?.message ?? "创建失败，请稍后重试");
        return;
      }
      window.location.assign(payload.projectUrl);
    } catch {
      setMessage("MiroFish 暂不可用");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 border border-border-strong px-3 py-1.5 font-mono text-[11px] tracking-[0.8px] text-fg-muted transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent"
        >
          <BrainCircuit className="h-3.5 w-3.5" aria-hidden="true" />
          模拟预测
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <textarea
        value={requirement}
        onChange={(event) => setRequirement(event.target.value)}
        rows={3}
        maxLength={2000}
        autoFocus
        placeholder="输入你想推演的方向 / 观点（留空则用默认推演需求）"
        className="w-full resize-y border border-border-strong bg-transparent px-3 py-2 font-mono text-[12px] text-fg placeholder:text-fg-soft focus:border-accent/40 focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={handleSubmit}
          className={`inline-flex items-center gap-1.5 border border-border-strong px-3 py-1.5 font-mono text-[11px] tracking-[0.8px] transition-colors ${
            loading
              ? "cursor-not-allowed text-fg-soft opacity-60"
              : "text-fg-muted hover:border-accent/40 hover:bg-accent/5 hover:text-accent"
          }`}
        >
          <BrainCircuit className="h-3.5 w-3.5" aria-hidden="true" />
          {loading ? "创建中" : "开始模拟"}
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => setOpen(false)}
          className="font-mono text-[11px] tracking-[0.8px] text-fg-soft transition-colors hover:text-fg-muted"
        >
          取消
        </button>
        {message ? <span className="font-mono text-[11px] text-danger">{message}</span> : null}
      </div>
    </div>
  );
}
