import { WorkerMonitor } from "@/components/worker/worker-monitor";
import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";

export default function AdminWorkerPage(): React.JSX.Element {
  return (
    <PageFrame size="full">
      <PageHeader
        eyebrow="/ 运行监控 · ADMIN · WORKER"
        title="运行监控"
        description="Worker 心跳、BullMQ 队列积压与信源抓取健康度。每 10 秒自动刷新。"
      />
      <WorkerMonitor />
    </PageFrame>
  );
}
