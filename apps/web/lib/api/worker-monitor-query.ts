import { Queue } from "bullmq";
import IORedis from "ioredis";
import { QUEUES, QUEUE_CLEANUP } from "@fe-radar/shared";

import { isMockMode } from "@/lib/mock-mode";

// Per-instance heartbeat keys: "fe:worker:heartbeat:<pid>". Aggregated across
// instances so multi-worker / rolling restarts don't false-report offline.
const HEARTBEAT_KEY_PREFIX = "fe:worker:heartbeat:";
const HEARTBEAT_ALIVE_MAX_AGE_SECONDS = 45;

// key -> 中文 label，顺序即返回顺序（契约固定，勿改）。
// 前 8 条来自 @fe-radar/shared QUEUES；后 4 条为 v1.1 + cleanup 字面量。
const QUEUE_DEFS: ReadonlyArray<{ key: string; label: string }> = [
  { key: QUEUES.fetch, label: "抓取" },
  { key: QUEUES.prefilter, label: "预筛" },
  { key: QUEUES.ner, label: "NER" },
  { key: QUEUES.scorer, label: "评分" },
  { key: QUEUES.embedder, label: "向量" },
  { key: QUEUES.cluster, label: "聚簇" },
  { key: QUEUES.curator, label: "精选" },
  { key: QUEUES.daily, label: "日报" },
  { key: "fe-quotes-fetch", label: "行情抓取" },
  { key: "fe-briefing-gen", label: "简报生成" },
  { key: "fe-briefing-push", label: "简报推送" },
  { key: QUEUE_CLEANUP, label: "清理" }
];

// Per-key parse result (one worker instance).
interface HeartbeatSample {
  alive: boolean;
  lastSeenIso: string | null;
  ageSeconds: number | null;
}

export interface WorkerHeartbeat {
  alive: boolean;
  lastSeenIso: string | null;
  ageSeconds: number | null;
  // Number of distinct worker instances currently considered alive.
  instances: number;
}

export interface WorkerQueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  paused: number;
}

export interface WorkerQueueStatus {
  key: string;
  label: string;
  counts: WorkerQueueCounts;
  nextRunIso: string | null;
}

export interface WorkerMonitorPayload {
  redis: "ok" | "unreachable";
  heartbeat: WorkerHeartbeat;
  queues: WorkerQueueStatus[];
}

const EMPTY_COUNTS: WorkerQueueCounts = {
  waiting: 0,
  active: 0,
  delayed: 0,
  completed: 0,
  failed: 0,
  paused: 0
};

function mockPayload(): WorkerMonitorPayload {
  return {
    redis: "ok",
    heartbeat: { alive: false, lastSeenIso: null, ageSeconds: null, instances: 0 },
    queues: QUEUE_DEFS.map((def) => ({
      key: def.key,
      label: def.label,
      counts: { ...EMPTY_COUNTS },
      nextRunIso: null
    }))
  };
}

function parseHeartbeat(raw: string | null): HeartbeatSample {
  if (!raw) {
    return { alive: false, lastSeenIso: null, ageSeconds: null };
  }
  let ts: string | null = null;
  try {
    const parsed = JSON.parse(raw) as { ts?: unknown };
    if (typeof parsed.ts === "string") {
      ts = parsed.ts;
    }
  } catch {
    return { alive: false, lastSeenIso: null, ageSeconds: null };
  }
  if (!ts) {
    return { alive: false, lastSeenIso: null, ageSeconds: null };
  }
  const lastSeenMs = Date.parse(ts);
  if (Number.isNaN(lastSeenMs)) {
    return { alive: false, lastSeenIso: ts, ageSeconds: null };
  }
  const ageSeconds = Math.max(0, Math.round((Date.now() - lastSeenMs) / 1000));
  return {
    alive: ageSeconds <= HEARTBEAT_ALIVE_MAX_AGE_SECONDS,
    lastSeenIso: ts,
    ageSeconds
  };
}

// SCAN all per-instance heartbeat keys (non-blocking; small key space).
async function scanHeartbeatKeys(connection: IORedis): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await connection.scan(cursor, "MATCH", `${HEARTBEAT_KEY_PREFIX}*`, "COUNT", 100);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

// Aggregate instances: alive if ANY instance is fresh; report the freshest
// lastSeen/age and the count of alive instances.
function aggregateHeartbeat(rawValues: Array<string | null>): WorkerHeartbeat {
  const samples = rawValues.map(parseHeartbeat).filter((s) => s.lastSeenIso !== null);
  if (samples.length === 0) {
    return { alive: false, lastSeenIso: null, ageSeconds: null, instances: 0 };
  }
  let freshest = samples[0]!;
  for (const s of samples) {
    if (s.ageSeconds !== null && (freshest.ageSeconds === null || s.ageSeconds < freshest.ageSeconds)) {
      freshest = s;
    }
  }
  const aliveInstances = samples.filter((s) => s.alive).length;
  return {
    alive: aliveInstances > 0,
    lastSeenIso: freshest.lastSeenIso,
    ageSeconds: freshest.ageSeconds,
    instances: aliveInstances
  };
}

async function readNextRunIso(queue: Queue): Promise<string | null> {
  let nextMillis: number | null = null;
  // 优先 getJobSchedulers；不可用 / 抛错时 fallback getRepeatableJobs。
  try {
    const schedulers = await queue.getJobSchedulers();
    for (const sched of schedulers) {
      if (typeof sched.next === "number" && (nextMillis === null || sched.next < nextMillis)) {
        nextMillis = sched.next;
      }
    }
  } catch {
    try {
      const repeatables = await queue.getRepeatableJobs();
      for (const job of repeatables) {
        if (typeof job.next === "number" && (nextMillis === null || job.next < nextMillis)) {
          nextMillis = job.next;
        }
      }
    } catch {
      return null;
    }
  }
  return nextMillis === null ? null : new Date(nextMillis).toISOString();
}

export async function fetchWorkerMonitor(): Promise<WorkerMonitorPayload> {
  if (isMockMode()) {
    return mockPayload();
  }

  const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  // 每次请求的监控客户端必须有界：Redis 不可达时命令应在 connectTimeout 内 reject
  // （触发 catch 降级），而非无限等待。注意必须保留默认的 offline 队列（enableOfflineQueue
  // 不设为 false）：否则首条命令会在 TCP 连接完成前发出、直接抛
  // "Stream isn't writeable"，把可达的 Redis 误判为 unreachable。有界性由
  // connectTimeout + retryStrategy(()=>null) 保证：连接失败即放弃并 reject 排队命令。
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    retryStrategy: () => null,
    lazyConnect: false
  });
  // 防止未捕获的 'error' 事件让进程崩溃。
  connection.on("error", () => undefined);
  const queues: Queue[] = [];

  try {
    const heartbeatKeys = await scanHeartbeatKeys(connection);
    const rawHeartbeats = heartbeatKeys.length > 0 ? await connection.mget(heartbeatKeys) : [];
    const heartbeat = aggregateHeartbeat(rawHeartbeats);

    const queueStatuses = await Promise.all(
      QUEUE_DEFS.map(async (def) => {
        const queue = new Queue(def.key, { connection });
        queues.push(queue);
        const [counts, nextRunIso] = await Promise.all([
          queue.getJobCounts("waiting", "active", "delayed", "completed", "failed", "paused"),
          readNextRunIso(queue)
        ]);
        const status: WorkerQueueStatus = {
          key: def.key,
          label: def.label,
          counts: {
            waiting: counts["waiting"] ?? 0,
            active: counts["active"] ?? 0,
            delayed: counts["delayed"] ?? 0,
            completed: counts["completed"] ?? 0,
            failed: counts["failed"] ?? 0,
            paused: counts["paused"] ?? 0
          },
          nextRunIso
        };
        return status;
      })
    );

    return {
      redis: "ok",
      heartbeat,
      queues: queueStatuses
    };
  } catch {
    // Redis 不可达 / 超时：优雅降级，绝不抛 500。
    return {
      redis: "unreachable",
      heartbeat: { alive: false, lastSeenIso: null, ageSeconds: null, instances: 0 },
      queues: []
    };
  } finally {
    await Promise.allSettled(queues.map((queue) => queue.close()));
    // disconnect() 立即关闭，不等待 live connection（quit() 在 Redis 不可达时可能挂起）。
    connection.disconnect();
  }
}
