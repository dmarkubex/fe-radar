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
    try {
      const res = await fetch(`/api/briefing/${briefingId}/download`);
      if (res.status === 410) {
        setGone(true);
        return;
      }
      if (!res.ok) return;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `briefing-${briefingDate}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silent fail — user can retry
    } finally {
      setChecking(false);
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={checking}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono border border-border rounded-[1px] transition-colors
        ${checking
          ? "text-fg-soft cursor-not-allowed opacity-60"
          : "text-fg-muted hover:bg-surface-warm hover:text-fg cursor-pointer"
        }`}
    >
      <Download className="h-3 w-3" />
      {checking ? "下载中…" : "下载 docx"}
    </button>
  );
}
