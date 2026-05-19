"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

interface RegenerateButtonProps {
  briefingId: number;
  genStatus: string;
  isAdmin: boolean;
}

export function RegenerateButton({ briefingId, genStatus, isAdmin }: RegenerateButtonProps): React.JSX.Element | null {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<"ok" | "error" | null>(null);

  // Only admins see this button; also disable when pending
  if (!isAdmin) return null;

  const disabled = loading || genStatus === "pending";

  async function handleClick(): Promise<void> {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/briefing/${briefingId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      setResult(res.ok ? "ok" : "error");
    } catch {
      setResult("error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={disabled}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono border rounded-[1px] transition-colors
          ${disabled
            ? "border-border text-fg-soft cursor-not-allowed opacity-50"
            : "border-border text-fg-muted hover:bg-surface-warm hover:text-fg cursor-pointer"
          }`}
        title={genStatus === "pending" ? "简报生成中，请稍候" : "重新生成简报（仅 admin）"}
      >
        <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        重新生成
      </button>
      {result === "ok" && (
        <span className="text-[11px] text-ok font-mono">已加入队列</span>
      )}
      {result === "error" && (
        <span className="text-[11px] text-danger font-mono">操作失败，请重试</span>
      )}
    </div>
  );
}
