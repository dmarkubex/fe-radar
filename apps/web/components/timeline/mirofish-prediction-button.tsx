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
  const [message, setMessage] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/items/${itemId}/mirofish`, { method: "POST" });
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

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <button
        type="button"
        disabled={loading}
        onClick={handleClick}
        className={`inline-flex items-center gap-1.5 border border-border-strong px-3 py-1.5 font-mono text-[11px] tracking-[0.8px] transition-colors ${
          loading
            ? "cursor-not-allowed text-fg-soft opacity-60"
            : "text-fg-muted hover:border-accent/40 hover:bg-accent/5 hover:text-accent"
        }`}
      >
        <BrainCircuit className="h-3.5 w-3.5" aria-hidden="true" />
        {loading ? "创建中" : "模拟预测"}
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </button>
      {message ? <span className="font-mono text-[11px] text-danger">{message}</span> : null}
    </div>
  );
}
