import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  CLAIMABLE_TARGET_STATUSES,
  REPROCESS_LOCK_KEY,
  acquireReprocessLock,
  admitWithRunCap,
  parseReprocessArgs,
  prepareRunLockQuery,
  processReprocessTarget,
  wasTargetClaimed,
  type TargetDependencies
} from "../reprocess-scoring";

function dependencies(
  getIndustryRelated: TargetDependencies["getIndustryRelated"]
): TargetDependencies {
  return {
    getIndustryRelated,
    clearFiltered: vi.fn().mockResolvedValue(undefined),
    runPrefilter: vi.fn().mockResolvedValue(undefined),
    admit: vi.fn().mockResolvedValue({
      state: "admitted",
      counterKey: "scoring:counter:normal:2026-08-04"
    }),
    runScorer: vi.fn().mockResolvedValue(undefined),
    runCurator: vi.fn().mockResolvedValue(undefined)
  };
}

describe("scoring reprocess", () => {
  it("clears a known false target without any LLM or quota call", async () => {
    const deps = dependencies(vi.fn().mockResolvedValue(false));

    await expect(processReprocessTarget(1, "2026-08-04", deps)).resolves.toBe(
      "skipped_filter"
    );
    expect(deps.clearFiltered).toHaveBeenCalledOnce();
    expect(deps.runPrefilter).not.toHaveBeenCalled();
    expect(deps.admit).not.toHaveBeenCalled();
    expect(deps.runScorer).not.toHaveBeenCalled();
    expect(deps.runCurator).not.toHaveBeenCalled();
  });

  it("reruns an unknown prefilter and only scores after it becomes true", async () => {
    const getIndustryRelated = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(true);
    const deps = dependencies(getIndustryRelated);

    await expect(processReprocessTarget(2, "2026-08-04", deps)).resolves.toBe(
      "completed"
    );
    expect(deps.runPrefilter).toHaveBeenCalledOnce();
    expect(deps.admit).toHaveBeenCalledWith(2, "2026-08-04");
    expect(deps.runScorer).toHaveBeenCalledOnce();
    expect(deps.runCurator).toHaveBeenCalledOnce();
  });

  it("checkpoints quota exhaustion without calling scorer", async () => {
    const deps = dependencies(vi.fn().mockResolvedValue(true));
    vi.mocked(deps.admit).mockResolvedValue({
      state: "pending_over_quota",
      counterKey: "scoring:counter:normal:2026-08-04"
    });

    await expect(processReprocessTarget(3, "2026-08-04", deps)).resolves.toBe(
      "pending_quota"
    );
    expect(deps.runScorer).not.toHaveBeenCalled();
    expect(deps.runCurator).not.toHaveBeenCalled();
  });

  it("still clears a later false target after the run admission cap is reached", async () => {
    const redisAdmit = vi.fn();
    await expect(
      admitWithRunCap(400, 400, "canary-7d", redisAdmit)
    ).resolves.toMatchObject({ state: "pending_over_quota" });
    expect(redisAdmit).not.toHaveBeenCalled();

    const capped = dependencies(vi.fn().mockResolvedValue(true));
    vi.mocked(capped.admit).mockResolvedValue({
      state: "pending_over_quota",
      counterKey: "scoring-reprocess:local-cap:canary-7d"
    });
    const laterFalse = dependencies(vi.fn().mockResolvedValue(false));

    await expect(
      processReprocessTarget(30, "2026-08-04", capped)
    ).resolves.toBe("pending_quota");
    await expect(
      processReprocessTarget(31, "2026-08-04", laterFalse)
    ).resolves.toBe("skipped_filter");
    expect(laterFalse.clearFiltered).toHaveBeenCalledOnce();
    expect(laterFalse.admit).not.toHaveBeenCalled();
  });

  it("keeps the admission counted when scorer or curator fails", async () => {
    const deps = dependencies(vi.fn().mockResolvedValue(true));
    vi.mocked(deps.runCurator).mockRejectedValue(new Error("curator failed"));

    await expect(processReprocessTarget(4, "2026-08-04", deps)).rejects.toThrow(
      "curator failed"
    );
    expect(deps.admit).toHaveBeenCalledOnce();
    expect(deps.runScorer).toHaveBeenCalledOnce();
    expect(deps.runCurator).toHaveBeenCalledOnce();
  });

  it("requires fixed windows for prepare and keeps apply explicit", () => {
    expect(
      parseReprocessArgs([
        "--run-id",
        "canary-7d",
        "--prepare",
        "--from",
        "2026-07-28T00:00:00+08:00",
        "--until",
        "2026-08-04T00:00:00+08:00"
      ])
    ).toMatchObject({
      runId: "canary-7d",
      prepare: true,
      apply: false,
      maxAdmitted: 400
    });
    expect(parseReprocessArgs(["--run-id", "canary-7d", "--apply"])).toEqual({
      runId: "canary-7d",
      prepare: false,
      apply: true,
      maxAdmitted: 400,
      recoverRunning: false
    });
    expect(() =>
      parseReprocessArgs(["--run-id", "canary-7d", "--prepare"])
    ).toThrow("固定窗口");
    expect(
      parseReprocessArgs([
        "--run-id",
        "canary-7d",
        "--apply",
        "--max-admitted",
        "25"
      ]).maxAdmitted
    ).toBe(25);
    expect(() =>
      parseReprocessArgs([
        "--run-id",
        "canary-7d",
        "--apply",
        "--max-admitted",
        "1301"
      ])
    ).toThrow("1–1300");
    expect(
      parseReprocessArgs([
        "--run-id",
        "canary-7d",
        "--recover-running",
        "--apply"
      ]).recoverRunning
    ).toBe(true);
    expect(() =>
      parseReprocessArgs(["--run-id", "canary-7d", "--recover-running"])
    ).toThrow("必须单独与 --apply 使用");
  });

  it("uses one global lock and rejects any concurrent reprocess run", async () => {
    const redis = { eval: vi.fn().mockResolvedValue(0) };
    await expect(
      acquireReprocessLock(redis as never, "canary-7d")
    ).rejects.toThrow("另一个历史重算进程");
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      REPROCESS_LOCK_KEY,
      expect.any(String),
      expect.any(Number)
    );
  });

  it("releases an acquired run lock with its ownership token", async () => {
    const redis = { eval: vi.fn().mockResolvedValue(1) };
    const lock = await acquireReprocessLock(redis as never, "canary-7d");
    lock.assertOwned();
    await lock.release();
    expect(redis.eval).toHaveBeenCalledTimes(2);
  });

  it("never claims running targets during ordinary apply and skips a lost CAS", () => {
    expect(CLAIMABLE_TARGET_STATUSES).not.toContain("running");
    expect(wasTargetClaimed([])).toBe(false);
    expect(wasTargetClaimed([{ itemId: 42 }])).toBe(true);
  });

  it("serializes prepare by run id before reading or inserting targets", () => {
    const query = new PgDialect().sqlToQuery(prepareRunLockQuery("canary-7d"));
    expect(query.sql).toContain("pg_advisory_xact_lock(hashtext($1)::bigint)");
    expect(query.params).toEqual(["canary-7d"]);
  });
});
