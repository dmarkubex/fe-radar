import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

export const CLUSTER_LOCK_KEY = "cluster:create:lock";

export const ACQUIRE_CLUSTER_LOCK_LUA = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
  return 1
end
return 0
`;

export const RELEASE_CLUSTER_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export async function withClusterCreateLock<T>(redis: Pick<Redis, "eval">, fn: () => Promise<T>, ttlMs = 5000): Promise<T> {
  const token = randomUUID();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const acquired = await redis.eval(ACQUIRE_CLUSTER_LOCK_LUA, 1, CLUSTER_LOCK_KEY, token, ttlMs) as number;
    if (acquired === 1) {
      try {
        return await fn();
      } finally {
        await redis.eval(RELEASE_CLUSTER_LOCK_LUA, 1, CLUSTER_LOCK_KEY, token);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Failed to acquire cluster create lock");
}
