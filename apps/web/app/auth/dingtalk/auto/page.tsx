import { isDingtalkEnabled } from "@/lib/auth/dingtalk-provider";
import { normalizeSafeCallbackUrl } from "@/lib/auth/safe-callback-url";
import { AutoLoginClient } from "./auto-login";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DingtalkAutoLoginPage({
  searchParams
}: PageProps): Promise<React.JSX.Element> {
  const params = await searchParams;
  const rawCallback = typeof params.callbackUrl === "string" ? params.callbackUrl : "/";
  const callbackUrl = normalizeSafeCallbackUrl(rawCallback);
  const dingtalkEnabled = isDingtalkEnabled();
  const corpId = process.env.DINGTALK_CORP_ID?.trim() || "";

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-bg p-6">
      <div className="w-full max-w-[420px] border border-border bg-surface p-7 shadow-pop">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[1.4px] text-fg-muted">
          / 钉钉内免登
        </div>
        <h1 className="mb-2 font-display text-[28px] font-normal">正在验证企业身份</h1>
        <p className="mb-6 text-sm text-fg-muted">
          从钉钉打开时将自动完成登录并返回原页面，无需扫码。
        </p>
        <AutoLoginClient
          callbackUrl={callbackUrl}
          corpId={corpId}
          dingtalkEnabled={dingtalkEnabled}
        />
      </div>
    </main>
  );
}
