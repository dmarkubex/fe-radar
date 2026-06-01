"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    console.error("[app/global-error]", error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f2f7fa",
          color: "#13313f",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "440px",
            margin: "0 24px",
            border: "1px solid #c0331a",
            borderLeftWidth: "4px",
            backgroundColor: "#ffffff",
            padding: "32px"
          }}
        >
          <div
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "10px",
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "1.4px",
              color: "#c0331a"
            }}
          >
            FATAL · 应用异常
          </div>
          <h1
            style={{
              margin: "12px 0 0",
              fontSize: "24px",
              fontWeight: 600,
              letterSpacing: "-0.01em"
            }}
          >
            应用出现严重错误
          </h1>
          <p
            style={{
              margin: "8px 0 0",
              fontSize: "14px",
              lineHeight: 1.6,
              color: "#4d6674"
            }}
          >
            页面无法正常显示,请刷新重试。如果问题持续存在,请联系管理员。
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: "24px",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              border: "1px solid #00618f",
              backgroundColor: "#00618f",
              color: "#ffffff",
              padding: "8px 16px",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer"
            }}
          >
            刷新
          </button>
        </div>
      </body>
    </html>
  );
}
