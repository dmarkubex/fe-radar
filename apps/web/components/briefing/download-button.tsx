"use client";

import { useState } from "react";
import { Download } from "lucide-react";

interface DownloadButtonProps {
  briefingId: number;
  briefingDate: string;
  /** If true the docx has passed the 90-day retention window */
  expired: boolean;
}

export function DownloadButton({ briefingId, briefingDate, expired }: DownloadButtonProps): React.JSX.Element {
  const [checking, setChecking] = useState(false);
  const [gone, setGone] = useState(expired);
  const [error, setError] = useState<string | null>(null);

  if (gone) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono border border-border rounded-[1px] text-fg-soft cursor-not-allowed opacity-60"
        title="已过保留期（design §8 FR-110）"
      >
        <Download className="h-3 w-3" />
        已过保留期
      </span>
    );
  }

  async function handleDownload(): Promise<void> {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch(`/api/briefing/${briefingId}/download`);
      if (res.status === 410) {
        setGone(true);
        return;
      }
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(payload?.error?.message ?? "下载失败，请稍后重试");
        return;
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.startsWith("application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
        setError("下载失败：服务器返回的文件类型不正确");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `briefing-${briefingDate}.docx`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setError("下载失败，请检查网络后重试");
    } finally {
      setChecking(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        onClick={handleDownload}
        disabled={checking}
        type="button"
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono border border-border rounded-[1px] transition-colors
          ${checking
            ? "text-fg-soft cursor-not-allowed opacity-60"
            : "text-fg-muted hover:bg-surface-warm hover:text-fg cursor-pointer"
          }`}
      >
        <Download className="h-3 w-3" />
        {checking ? "下载中…" : "下载 docx"}
      </button>
      {error ? <span className="max-w-56 text-[11px] text-danger" role="alert">{error}</span> : null}
    </span>
  );
}
