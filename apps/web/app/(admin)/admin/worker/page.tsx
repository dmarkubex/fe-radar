import { WorkerMonitor } from "@/components/worker/worker-monitor";

export const dynamic = "force-dynamic";

export default function AdminWorkerPage(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-bg pad-fluid font-body text-fg">
      <div className="mx-auto w-full max-w-7xl space-y-8">
        <header className="space-y-2">
          <p className="font-mono text-xs tracking-wide text-fg-soft uppercase">
            / 运行监控 · ADMIN · WORKER
          </p>
          <h1 className="font-display display-fluid tracking-tightest text-fg">
            运行监控
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-fg-muted">
            Worker 心跳、BullMQ 队列积压与信源抓取健康度。每 10 秒自动刷新。
          </p>
        </header>

        <WorkerMonitor />
      </div>
    </main>
  );
}
