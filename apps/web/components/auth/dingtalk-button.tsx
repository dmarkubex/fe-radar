"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getDingtalkFrameLoginParams, type DingtalkFrameLoginParams } from "@/lib/auth/dingtalk-frame";

const DINGTALK_LOGIN_SCRIPT_ID = "dingtalk-login-sdk";
const DINGTALK_LOGIN_SCRIPT_URL = "https://g.alicdn.com/dingding/h5-dingtalk-login/0.21.0/ddlogin.js";
const DINGTALK_FRAME_ID = "dingtalk-login-frame";
let dingtalkLoginScript: Promise<void> | null = null;

interface DingtalkFrameParams {
  id: string;
  width: number;
  height: number;
}

interface DingtalkLoginSuccess {
  redirectUrl?: string;
  authCode?: string;
  code?: string;
  state?: string;
}

declare global {
  interface Window {
    DTFrameLogin?: (
      frameParams: DingtalkFrameParams,
      loginParams: DingtalkFrameLoginParams,
      success: (result: DingtalkLoginSuccess) => void,
      failure?: (message: string) => void
    ) => void;
  }
}

export function DingtalkButton(): React.JSX.Element {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function openDingtalk(): Promise<void> {
    setError(null);
    try {
      const result = await signIn("dingtalk", { callbackUrl, redirect: false });
      if (!result?.url) {
        throw new Error("DingTalk authorization URL missing");
      }

      const loginParams = getDingtalkFrameLoginParams(result.url);
      await loadDingtalkLoginScript();
      window.DTFrameLogin?.(
        { id: DINGTALK_FRAME_ID, width: 300, height: 300 },
        loginParams,
        (loginResult) => {
          if (loginResult.redirectUrl) {
            window.location.href = loginResult.redirectUrl;
            return;
          }

          const authCode = loginResult.authCode ?? loginResult.code;
          const callback = new URL(decodeURIComponent(loginParams.redirect_uri));
          if (authCode) callback.searchParams.set("authCode", authCode);
          if (loginResult.state) callback.searchParams.set("state", loginResult.state);
          window.location.href = callback.toString();
        },
        (message) => setError(message || "钉钉二维码加载失败")
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "钉钉二维码加载失败");
    }
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void openDingtalk();
  }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      <div id={DINGTALK_FRAME_ID} className="h-[300px] w-[300px]" />
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {error ? (
        <Button type="button" variant="outline" onClick={() => void openDingtalk()}>
          重新生成二维码
        </Button>
      ) : null}
    </div>
  );
}

function loadDingtalkLoginScript(): Promise<void> {
  if (window.DTFrameLogin) {
    return Promise.resolve();
  }
  if (dingtalkLoginScript) {
    return dingtalkLoginScript;
  }

  dingtalkLoginScript = new Promise((resolve, reject) => {
    const existing = document.getElementById(DINGTALK_LOGIN_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("DingTalk login SDK load failed")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = DINGTALK_LOGIN_SCRIPT_ID;
    script.src = DINGTALK_LOGIN_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("DingTalk login SDK load failed"));
    document.head.appendChild(script);
  });

  return dingtalkLoginScript;
}
