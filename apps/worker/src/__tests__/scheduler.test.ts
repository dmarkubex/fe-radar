import { describe, expect, it, vi } from "vitest";
import { FETCH_SCHEDULE_CRON, FETCH_SCHEDULE_TZ } from "../queues";
import { enqueueEnabledSources, shouldDisableSource } from "../scheduler";

describe("scheduler", () => {
  it("uses 6h Asia/Shanghai cron", () => {
    expect(FETCH_SCHEDULE_CRON).toBe("0 */6 * * *");
    expect(FETCH_SCHEDULE_TZ).toBe("Asia/Shanghai");
  });

  it("disables source after 7 failed days", () => {
    expect(shouldDisableSource({ failCount: 6 })).toBe(false);
    expect(shouldDisableSource({ failCount: 7 })).toBe(true);
  });

  it("enqueues enabled sources", async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            where: vi.fn(async () => [{ id: 1 }, { id: 2 }])
          }))
        }))
      }))
    };
    const queue = { add: vi.fn(async () => undefined) };
    await expect(enqueueEnabledSources(db as never, queue as never)).resolves.toBe(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });
});
