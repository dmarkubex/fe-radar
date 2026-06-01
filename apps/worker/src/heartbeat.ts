import { logger } from "./handlers/context";

// Per-instance heartbeat key so multiple workers / rolling restarts don't
// clobber each other's liveness. Monitor side aggregates the freshest instance.
export const HEARTBEAT_KEY_PREFIX = "fe:worker:heartbeat:";
export const HEARTBEAT_INTERVAL_MS = 15000;
export const HEARTBEAT_TTL_SECONDS = 60;

interface HeartbeatConnection {
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface HeartbeatHandle {
  key: string;
  stop(): Promise<void>;
}

// Starts a per-instance heartbeat writer + interval. Returns a handle whose
// stop() clears the interval and deletes the heartbeat key (awaited, errors
// caught) for graceful shutdown.
export function startHeartbeat(connection: HeartbeatConnection): HeartbeatHandle {
  const heartbeatKey = `${HEARTBEAT_KEY_PREFIX}${process.pid}`;
  const writeHeartbeat = (): void => {
    const payload = JSON.stringify({
      ts: new Date().toISOString(),
      pid: process.pid,
      name: "fe-radar-worker",
    });
    connection.set(heartbeatKey, payload, "EX", HEARTBEAT_TTL_SECONDS).catch((err: unknown) => {
      logger.warn({ err }, "heartbeat write failed");
    });
  };
  writeHeartbeat();
  const heartbeatInterval = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
  heartbeatInterval.unref();

  return {
    key: heartbeatKey,
    async stop(): Promise<void> {
      clearInterval(heartbeatInterval);
      try {
        await connection.del(heartbeatKey);
      } catch (err) {
        logger.warn({ err }, "heartbeat key cleanup failed");
      }
    },
  };
}
