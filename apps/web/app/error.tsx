"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw, Home } from "lucide-react";

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center pad-fluid-x py-16">
      <div className="w-full max-w-[480px] border border-danger border-l-4 bg-surface p-8">
        <div className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[1.4px] text-danger">
          <AlertTriangle className="h-3.5 w-3.5" />
          ERROR · 页面异常
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg">页面出错了</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          很抱歉,加载此页面时发生了错误。你可以尝试重新加载,或返回首页继续浏览。
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-fg-soft">错误编号 {error.digest}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-2 border border-accent bg-accent px-4 py-2 text-sm font-medium text-surface transition-colors hover:bg-accent-flame"
          >
            <RotateCw className="h-4 w-4" />
            重试
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 border border-border px-4 py-2 text-sm font-medium text-fg transition-colors hover:border-border-strong"
          >
            <Home className="h-4 w-4" />
            返回首页
          </Link>
        </div>
      </div>
    </main>
  );
}
