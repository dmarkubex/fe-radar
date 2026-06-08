import { fetchWorkerMonitor } from "@/lib/api/worker-monitor-query";

// 实时队列状态，禁止静态化 / 缓存。
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(await fetchWorkerMonitor());
}
