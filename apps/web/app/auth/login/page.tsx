import { DingtalkButton } from "@/components/auth/dingtalk-button";
import { isDingtalkEnabled } from "@/lib/auth/dingtalk-provider";
import { LocalLoginForm } from "./local-login-form";

export default function LoginPage(): React.JSX.Element {
  const dingtalkEnabled = isDingtalkEnabled();

  return (
    <div className="min-h-screen grid grid-cols-[1.1fr_1fr] max-[900px]:grid-cols-1">
      <aside className="bg-surface-deep text-white p-10 flex flex-col justify-between relative overflow-hidden max-[900px]:min-h-[380px] max-[900px]:p-8">
        <div className="z-[2] flex items-center gap-3.5">
          <img
            src="/fareast-logo.png"
            alt="远东控股集团"
            className="h-auto w-[176px] border border-white/[0.18] bg-white px-2.5 py-1.5"
          />
        </div>

        <div className="z-[2] grid grid-cols-[minmax(0,1.08fr)_minmax(220px,0.72fr)] gap-x-11 items-end max-[900px]:grid-cols-1">
          <div>
            <div className="font-mono text-[11px] tracking-[2px] uppercase text-sunshine-500 mb-6">
              / 行业情报雷达 V1
            </div>
            <h1 className="font-display text-[clamp(48px,5.7vw,72px)] leading-[0.95] tracking-[-1.6px] font-normal max-w-[9.5ch]">
              <span className="block">让行业信号先一步</span>
              <span className="block">进入决策视野。</span>
            </h1>
            <p className="text-white/70 text-base leading-[1.6] mt-5 max-w-[44ch]">
              每 6 小时抓取集团关注的行业信源，经 5 维评分和关注圈分类后，沉淀为时间线、精选、日报与告警。
            </p>
          </div>
          <div className="border-l border-white/[0.18] pl-7 grid gap-3.5 max-[900px]:border-l-0 max-[900px]:pl-0">
            <div className="font-mono text-[10px] leading-[1.4] tracking-[1.6px] uppercase text-white/48">
              Internal intelligence pipeline
            </div>
            <div className="grid grid-cols-[68px_1fr] gap-4 items-baseline py-3 border-t border-white/[0.12]">
              <b className="font-display text-[30px] leading-none font-normal tracking-[-0.6px] tabular-nums">35</b>
              <span className="text-white/68 text-[13px] leading-[1.35]">个 T1 / T2 / T3 行业信源持续抓取</span>
            </div>
            <div className="grid grid-cols-[68px_1fr] gap-4 items-baseline py-3 border-t border-white/[0.12]">
              <b className="font-display text-[30px] leading-none font-normal tracking-[-0.6px] tabular-nums">5</b>
              <span className="text-white/68 text-[13px] leading-[1.35]">维评分：政策、市场、技术、项目、公司</span>
            </div>
            <div className="grid grid-cols-[68px_1fr] gap-4 items-baseline py-3 border-t border-white/[0.12]">
              <b className="font-display text-[30px] leading-none font-normal tracking-[-0.6px] tabular-nums">6h</b>
              <span className="text-white/68 text-[13px] leading-[1.35]">滚动更新，仅供集团内部使用</span>
            </div>
          </div>
        </div>

        <div className="z-[2] flex justify-between font-mono text-[11px] tracking-[1px] text-white/45">
          <span>FE-Radar V0.6.4</span>
          <span>FE-RADAR.FE.LOCAL</span>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-2 flex">
          <i className="flex-1 bg-yellow" />
          <i className="flex-1 bg-gold" />
          <i className="flex-1 bg-sunshine-700" />
          <i className="flex-1 bg-accent-block" />
          <i className="flex-1 bg-accent-flame" />
          <i className="flex-1 bg-accent" />
        </div>
      </aside>

      <main className="bg-bg flex items-center justify-center p-12 max-[900px]:p-8">
        <div className="w-full max-w-[440px] bg-surface p-10 border border-border shadow-pop">
          <h2 className="font-display text-[36px] font-normal tracking-[-0.8px] mb-1.5">
            {dingtalkEnabled ? "钉钉扫码登录" : "本地账号登录"}
          </h2>
          <div className="text-fg-muted text-sm mb-8">
            {dingtalkEnabled
              ? "使用集团钉钉账号扫码进入 · 首次登录默认 viewer 权限"
              : "使用本地账号登录"}
          </div>

          {dingtalkEnabled ? (
            <div className="bg-bg-deep p-6 flex flex-col items-center gap-3.5">
              <div className="w-[200px] h-[200px] bg-white p-3 flex items-center justify-center">
                <div className="text-center text-fg-soft text-sm">
                  <DingtalkButton />
                </div>
              </div>
              <div className="font-mono text-[11px] tracking-[1px] text-fg-soft flex items-center gap-2">
                <span className="inline-block w-2 h-2 bg-ok rounded-full" style={{ boxShadow: "0 0 0 4px rgba(47,125,79,0.18)" }} />
                等待扫码 · 二维码 90 秒后自动刷新
              </div>
              <div className="text-[13px] text-fg-muted text-center">
                打开钉钉 APP → 右上角 + → 扫一扫
              </div>
            </div>
          ) : (
            <LocalLoginForm />
          )}

          <div className="mt-8 pt-6 border-t border-border text-[13px]">
            {dingtalkEnabled ? (
              <form action="/api/auth/callback/credentials" method="post">
                <button
                  type="submit"
                  className="text-accent tracking-[0.4px] uppercase text-xs bg-transparent border-0"
                >
                  使用本地账号登录 →
                </button>
                <input type="hidden" name="username" value="" />
                <input type="hidden" name="password" value="" />
                <small className="block text-fg-soft mt-2 text-xs">
                  仅供 IT / 运维人员在 SSO 异常时使用
                </small>
              </form>
            ) : (
              <small className="block text-fg-soft text-xs">
                本地账号模式 · 需 admin 预置
              </small>
            )}
          </div>

          <div className="mt-7 font-mono text-[10px] tracking-[1px] text-fg-soft uppercase flex justify-between">
            <span>© 远东控股集团</span>
            <span>FE-Radar V0.6.4</span>
          </div>
        </div>
      </main>
    </div>
  );
}
