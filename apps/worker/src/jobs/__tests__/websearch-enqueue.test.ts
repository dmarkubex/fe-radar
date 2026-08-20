import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as FeRadarCore from "@fe-radar/core";

const { mockAdmitWebSearch } = vi.hoisted(() => ({
  mockAdmitWebSearch: vi.fn(),
}));

vi.mock("@fe-radar/core", async (importOriginal) => {
  const actual = await importOriginal<typeof FeRadarCore>();
  return { ...actual, admitWebSearch: mockAdmitWebSearch };
});

import {
  enqueueWebsearchForEntities,
  websearchEntityCooldownKey,
} from "../websearch-enqueue";

function makeDeps() {
  const conn = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    decr: vi.fn().mockResolvedValue(1),
  };
  const queue = {
    add: vi.fn().mockResolvedValue(undefined),
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
  };
  return { conn, queue, logger };
}

describe("enqueueWebsearchForEntities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdmitWebSearch.mockResolvedValue({
      state: "admitted",
      counterKey: "websearch:counter:2026-08",
    });
  });

  it("enqueues, stamps 24h cooldown, and does not roll back on success", async () => {
    const deps = makeDeps();

    const stats = await enqueueWebsearchForEntities(
      [{ entityId: 5, entityName: "远东电缆" }],
      { itemId: 100, correlationId: "corr-1", ...deps },
    );

    expect(stats).toEqual({ enqueued: 1, skippedCooldown: 0, skippedQuota: 0 });
    expect(mockAdmitWebSearch).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}$/),
      deps.conn,
    );
    expect(deps.queue.add).toHaveBeenCalledWith("websearch", {
      entityId: 5,
      entityName: "远东电缆",
      itemId: 100,
      correlationId: "corr-1",
    });
    expect(deps.conn.set).toHaveBeenCalledWith(
      websearchEntityCooldownKey(5),
      "1",
      "EX",
      86400,
    );
    expect(deps.conn.decr).not.toHaveBeenCalled();
  });

  it("skips cooldown before consuming a quota incr", async () => {
    const deps = makeDeps();
    deps.conn.get.mockResolvedValue("1");

    const stats = await enqueueWebsearchForEntities(
      [{ entityId: 5, entityName: "远东电缆" }],
      { itemId: 100, ...deps },
    );

    expect(stats.skippedCooldown).toBe(1);
    expect(stats.enqueued).toBe(0);
    expect(mockAdmitWebSearch).not.toHaveBeenCalled();
    expect(deps.queue.add).not.toHaveBeenCalled();
    expect(deps.conn.set).not.toHaveBeenCalled();
  });

  it("discards when monthly quota is exhausted (warn, no enqueue, no cooldown)", async () => {
    const deps = makeDeps();
    mockAdmitWebSearch.mockResolvedValue({
      state: "pending_over_quota",
      counterKey: "websearch:counter:2026-08",
    });

    const stats = await enqueueWebsearchForEntities(
      [{ entityId: 5, entityName: "远东电缆" }],
      { itemId: 100, ...deps },
    );

    expect(stats.skippedQuota).toBe(1);
    expect(deps.queue.add).not.toHaveBeenCalled();
    expect(deps.conn.set).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 5, entityName: "远东电缆" }),
      "websearch monthly quota exhausted, discarding (no retry)",
    );
  });

  it("rolls back quota with DECR when enqueue or cooldown stamp fails", async () => {
    const deps = makeDeps();
    deps.queue.add.mockRejectedValue(new Error("bullmq down"));

    const stats = await enqueueWebsearchForEntities(
      [{ entityId: 5, entityName: "远东电缆" }],
      { itemId: 100, ...deps },
    );

    expect(stats.enqueued).toBe(0);
    expect(deps.conn.decr).toHaveBeenCalledWith("websearch:counter:2026-08");
    expect(deps.conn.set).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 5, entityName: "远东电缆" }),
      "websearch enqueue failed, quota rolled back",
    );
  });

  it("processes mixed targets: skip cooled, enqueue the rest", async () => {
    const deps = makeDeps();
    deps.conn.get
      .mockResolvedValueOnce("1")
      .mockResolvedValueOnce(null);

    const stats = await enqueueWebsearchForEntities(
      [
        { entityId: 1, entityName: "远东电缆" },
        { entityId: 2, entityName: "国家电网" },
      ],
      { itemId: 100, correlationId: "c", ...deps },
    );

    expect(stats).toEqual({ enqueued: 1, skippedCooldown: 1, skippedQuota: 0 });
    expect(deps.queue.add).toHaveBeenCalledTimes(1);
    expect(deps.queue.add).toHaveBeenCalledWith("websearch", {
      entityId: 2,
      entityName: "国家电网",
      itemId: 100,
      correlationId: "c",
    });
    expect(deps.conn.set).toHaveBeenCalledWith(
      "websearch:entity:2:24h",
      "1",
      "EX",
      86400,
    );
  });
});
