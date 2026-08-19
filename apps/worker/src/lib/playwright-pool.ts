/**
 * T-CA-04 / v1.3 design §3.4.2 Playwright 池段 —— worker 进程内唯一池入口。
 * 生产路径禁止直接 `createPlaywrightPool()`（仅本文件与 playwright.ts 定义处允许）；
 * 模块 mutex 保证并发 getter 只 launch 一次。
 */
import { createPlaywrightPool, type BrowserContextPool } from "../fetchers/playwright";

let poolPromise: Promise<BrowserContextPool> | null = null;

export function getOrCreatePlaywrightPool(): Promise<BrowserContextPool> {
  if (!poolPromise) {
    // launch 失败不缓存 rejected promise：下次 getter 重试（与 acquire in-flight 同语义）。
    poolPromise = createPlaywrightPool().catch((err: unknown) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

export async function closePlaywrightPool(): Promise<void> {
  const pending = poolPromise;
  poolPromise = null;
  if (!pending) return;
  const pool = await pending.catch(() => null);
  await pool?.close();
}
