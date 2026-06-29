"use client";

import { useState } from "react";
import { DingtalkButton } from "@/components/auth/dingtalk-button";
import { LocalLoginForm } from "./local-login-form";

interface LoginPanelProps {
  dingtalkEnabled: boolean;
  /** 钉钉启用时，本地登录是否解锁（EMERGENCY_LOCAL_LOGIN）。未解锁则隐藏本地入口。 */
  localLoginAllowed: boolean;
}

export function LoginPanel({ dingtalkEnabled, localLoginAllowed }: LoginPanelProps) {
  const [mode, setMode] = useState<"dingtalk" | "local">(
    dingtalkEnabled ? "dingtalk" : "local"
  );

  // Non-DingTalk environment: always local, no switching UI
  if (!dingtalkEnabled) {
    return (
      <>
        <h2 className="font-display text-[28px] lg:text-[32px] font-normal tracking-[-0.7px] mb-1.5">
          本地账号登录
        </h2>
        <div className="text-fg-muted text-sm mb-6">使用本地账号登录</div>
        <LocalLoginForm />
        <small className="mt-6 block text-fg-soft text-xs">
          本地账号模式；需 admin 预置（admin / admin123）
        </small>
      </>
    );
  }

  // DingTalk enabled - support switching, only one method shown at a time
  if (mode === "dingtalk") {
    return (
      <>
        <h2 className="font-display text-[28px] lg:text-[32px] font-normal tracking-[-0.7px] mb-1.5">
          钉钉扫码登录
        </h2>
        <div className="text-fg-muted text-sm mb-6">
          使用集团钉钉账号扫码进入，首次登录默认 viewer 权限
        </div>

        {/* DingTalk QR */}
        <div className="bg-bg-deep p-5 flex flex-col items-center gap-3">
          <div className="w-[168px] h-[168px] bg-white p-2.5 flex items-center justify-center">
            <div className="text-center text-fg-soft text-sm">
              <DingtalkButton />
            </div>
          </div>
          <div className="font-mono text-[10px] tracking-[1px] text-fg-soft flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 bg-ok rounded-full" />
            等待扫码，二维码 90 秒后自动刷新
          </div>
          <div className="text-[12px] text-fg-muted text-center">
            打开钉钉 APP → 右上角 + → 扫一扫
          </div>
        </div>

        {/* Switch trigger - only shown when local login is unlocked (emergency break-glass) */}
        {localLoginAllowed && (
          <div className="pt-6 text-center border-t border-border">
            <button
              onClick={() => setMode("local")}
              className="text-accent tracking-[0.4px] uppercase text-xs bg-transparent border-0 hover:underline"
            >
              使用本地账号登录 →
            </button>
            <small className="block text-fg-soft mt-2 text-xs">
              仅供 IT / 运维人员在 SSO 异常时使用
            </small>
          </div>
        )}
      </>
    );
  }

  // Local credentials mode (switched from DingTalk)
  return (
    <>
      <h2 className="font-display text-[28px] lg:text-[32px] font-normal tracking-[-0.7px] mb-1.5">
        本地账号登录
      </h2>
      <div className="text-fg-muted text-sm mb-6">使用本地账号登录</div>

      <LocalLoginForm />

      {/* Back link - clean switch */}
      <div className="pt-6 text-center border-t border-border">
        <button
          onClick={() => setMode("dingtalk")}
          className="text-fg-muted hover:text-accent text-xs tracking-[0.4px] underline-offset-2 hover:underline"
        >
          ← 返回钉钉扫码登录
        </button>
        <small className="mt-2 block text-fg-soft text-xs">
          本地账号仅供运维应急
        </small>
      </div>
    </>
  );
}
