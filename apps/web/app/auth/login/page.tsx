import { isDingtalkEnabled, isLocalLoginAllowed } from "@/lib/auth/dingtalk-provider";
import { LoginPanel } from "./login-panel";

export default function LoginPage(): React.JSX.Element {
  const dingtalkEnabled = isDingtalkEnabled();
  const localLoginAllowed = isLocalLoginAllowed();

  return (
    <div className="h-screen grid grid-cols-[1.1fr_1fr] max-[900px]:grid-cols-1 overflow-hidden">
      {/* Left hero panel - more compact for 14" screens */}
      <aside className="bg-surface-deep text-white p-6 lg:p-8 xl:p-10 flex flex-col justify-between relative overflow-hidden max-[900px]:min-h-[320px] max-[900px]:p-6">
        <div className="z-[2] flex items-center gap-3">
          <img
            src="/fareast-logo.png"
            alt="远东控股集团"
            className="h-auto w-[148px] lg:w-[164px] border border-white/[0.18] bg-white px-2 py-1"
          />
        </div>

        <div className="z-[2] grid grid-cols-[minmax(0,1.1fr)_minmax(200px,0.7fr)] gap-x-8 items-end max-[900px]:grid-cols-1">
          <div>
            <div className="font-mono text-[10px] tracking-[1.5px] uppercase text-sunshine-500 mb-4 lg:mb-5">
              / 行业情报雷达 V1
            </div>
            <h1 className="font-display text-[clamp(36px,4.8vw,60px)] leading-[0.92] tracking-[-1.4px] font-normal max-w-[10ch]">
              <span className="block">让行业信号先一步</span>
              <span className="block">进入决策视野。</span>
            </h1>
            <p className="text-white/70 text-sm lg:text-base leading-[1.55] mt-4 max-w-[42ch]">
              每 6 小时抓取集团关注的行业信源，经 5 维评分和关注圈分类后，沉淀为时间线、精选、日报与告警。
            </p>
          </div>

          <div className="border-l border-white/[0.18] pl-6 grid gap-2.5 max-[900px]:border-l-0 max-[900px]:pl-0 max-[900px]:mt-4">
            <div className="font-mono text-[9px] leading-[1.3] tracking-[1.4px] uppercase text-white/48">
              Internal intelligence pipeline
            </div>

            <div className="grid grid-cols-[56px_1fr] gap-3 items-baseline py-2 border-t border-white/[0.12]">
              <b className="font-display text-[24px] lg:text-[26px] leading-none font-normal tracking-[-0.5px] tabular-nums">35</b>
              <span className="text-white/68 text-[12px] leading-[1.3]">个 T1 / T2 / T3 行业信源持续抓取</span>
            </div>
            <div className="grid grid-cols-[56px_1fr] gap-3 items-baseline py-2 border-t border-white/[0.12]">
              <b className="font-display text-[24px] lg:text-[26px] leading-none font-normal tracking-[-0.5px] tabular-nums">5</b>
              <span className="text-white/68 text-[12px] leading-[1.3]">维评分：政策、市场、技术、项目、公司</span>
            </div>
            <div className="grid grid-cols-[56px_1fr] gap-3 items-baseline py-2 border-t border-white/[0.12]">
              <b className="font-display text-[24px] lg:text-[26px] leading-none font-normal tracking-[-0.5px] tabular-nums">6h</b>
              <span className="text-white/68 text-[12px] leading-[1.3]">滚动更新，仅供集团内部使用</span>
            </div>
          </div>
        </div>

        <div className="z-[2] flex justify-between font-mono text-[10px] tracking-[1px] text-white/45">
          <span>FE-Radar V0.6.4</span>
          <span>FE-RADAR.FE.LOCAL</span>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-1.5 flex">
          <i className="flex-1 bg-yellow" />
          <i className="flex-1 bg-gold" />
          <i className="flex-1 bg-sunshine-700" />
          <i className="flex-1 bg-accent" />
        </div>
      </aside>

      {/* Right form panel - compact for 14" screens, clean single-method switching */}
      <main className="bg-bg flex items-center justify-center p-6 lg:p-8 xl:p-10 overflow-auto">
        <div className="w-full max-w-[420px] bg-surface p-7 lg:p-8 border border-border shadow-pop">
          <LoginPanel dingtalkEnabled={dingtalkEnabled} localLoginAllowed={localLoginAllowed} />

          <div className="mt-7 font-mono text-[9px] tracking-[1px] text-fg-soft uppercase flex justify-between border-t border-border pt-5">
            <span>© 远东控股集团</span>
            <span>FE-Radar V0.6.4</span>
          </div>
        </div>
      </main>
    </div>
  );
}
