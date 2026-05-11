"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FeedbackButtons({ itemId }: { itemId: number }): React.JSX.Element {
  const [vote, setVote] = useState<-1 | 0 | 1>(0);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function submit(nextVote: -1 | 0 | 1): Promise<void> {
    setVote(nextVote);
    setStatus("saving");
    const response = await fetch(`/api/items/${itemId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote: nextVote, reason: reason || undefined })
    });
    setStatus(response.ok ? "saved" : "error");
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={vote === 1 ? "default" : "outline"} type="button" onClick={() => void submit(1)}>
          <ThumbsUp className="h-4 w-4" />
          有价值
        </Button>
        <Button size="sm" variant={vote === -1 ? "default" : "outline"} type="button" onClick={() => void submit(-1)}>
          <ThumbsDown className="h-4 w-4" />
          不准确
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => void submit(0)}>
          清除
        </Button>
        <span className="text-xs text-zinc-500">
          {status === "saving" ? "提交中" : status === "saved" ? "已保存" : status === "error" ? "提交失败" : ""}
        </span>
      </div>
      <textarea
        className="min-h-20 rounded-md border border-zinc-200 bg-white p-2 text-sm outline-none focus:border-zinc-400"
        maxLength={500}
        placeholder="备注"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
    </div>
  );
}
