"use client";

import { signIn } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeSafeCallbackUrl } from "@/lib/auth/safe-callback-url";
import { requestAuthCode } from "./dingtalk-jsapi";

interface AutoLoginClientProps {
  callbackUrl: string;
  corpId: string;
  dingtalkEnabled: boolean;
}

type Phase = "loading" | "error";

/**
 * DingTalk H5 free-login: request one-time auth code via official JSAPI, then
 * hand it to Auth.js Credentials provider `dingtalk-inapp`. Never retries the
 * same code on failure; user must click retry (new JSAPI code) or use QR login.
 */
export function AutoLoginClient({
  callbackUrl,
  corpId,
  dingtalkEnabled
}: AutoLoginClientProps): React.JSX.Element {
  const startedRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const safeCallback = normalizeSafeCallbackUrl(callbackUrl);
  const qrFallbackHref = `/auth/login?callbackUrl=${encodeURIComponent(safeCallback)}`;

  const runLogin = useCallback(async () => {
    if (!dingtalkEnabled) {
      setError("钉钉登录未启用");
      setPhase("error");
      return;
    }
    if (!corpId) {
      setError("企业 CorpId 未配置");
      setPhase("error");
      return;
    }

    try {
      const dd = await import("dingtalk-jsapi");
      const code = await requestAuthCode(dd, corpId);
      if (!code) {
        setError("未能获取钉钉免登码");
        setPhase("error");
        return;
      }

      const result = await signIn("dingtalk-inapp", {
        code,
        callbackUrl: safeCallback,
        redirect: false
      });

      if (!result?.ok || result.error) {
        setError("钉钉免登失败，请重试或改用扫码登录");
        setPhase("error");
        return;
      }

      window.location.href = safeCallback;
    } catch {
      setError("当前环境无法使用钉钉免登");
      setPhase("error");
    }
  }, [corpId, dingtalkEnabled, safeCallback]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void runLogin();
  }, [attempt, runLogin]);

  function handleRetry(): void {
    setError(null);
    setPhase("loading");
    startedRef.current = false;
    setAttempt((n) => n + 1);
  }

  if (phase === "error") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-danger" role="alert">
          {error ?? "钉钉免登失败"}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex items-center justify-center border border-border bg-surface px-[18px] py-[11px] text-[13px] tracking-[0.4px] text-fg hover:border-fg"
          >
            重试免登
          </button>
          <a
            href={qrFallbackHref}
            className="inline-flex items-center justify-center border border-fg bg-fg px-[18px] py-[11px] text-[13px] tracking-[0.4px] text-fg-on-dark hover:bg-accent"
          >
            使用钉钉扫码登录
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent"
        aria-hidden
      />
      <p className="text-sm text-fg-muted">正在通过钉钉验证身份…</p>
    </div>
  );
}
