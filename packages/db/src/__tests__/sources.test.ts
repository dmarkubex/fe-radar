import { afterEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "../client";
import {
  DuplicateEnabledSourceError,
  ProtectedSourceUrlError,
  SourceFetcherConfigMismatchError,
  SourceVerificationPolicyError,
  updateSource
} from "../repos/sources";
import { sources } from "../schema";

describe("sources schema", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps source indexes and unique url in schema metadata", () => {
    expect(sources.url).toBeDefined();
    expect(sources.failCount).toBeDefined();
    expect(sources.lastOkAt).toBeDefined();
    expect(sources.adminTouchedAt).toBeDefined();
    expect(sources.adminSnapshot).toBeDefined();
    expect(sources.urlLocked).toBeDefined();
  });

  it("records when an admin updates a source", async () => {
    const now = new Date("2026-07-17T08:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const returning = vi
      .fn()
      .mockResolvedValue([{ id: 7, adminTouchedAt: now }]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const selectWhere = vi.fn().mockResolvedValue([
      {
        url: "https://example.com/source",
        urlLocked: false,
        config: {}
      }
    ]);
    const from = vi.fn().mockReturnValue({ where: selectWhere });
    const db = {
      select: vi.fn().mockReturnValue({ from }),
      update: vi.fn().mockReturnValue({ set })
    } as unknown as DbClient;

    const updated = await updateSource(db, 7, { enabled: true });

    expect(set).toHaveBeenCalledWith({
      enabled: true,
      adminTouchedAt: now,
      adminSnapshot: expect.objectContaining({
        queryChunks: expect.arrayContaining([JSON.stringify({ enabled: true })])
      })
    });
    expect(updated?.adminTouchedAt).toEqual(now);
  });

  it("snapshots only an explicitly updated config", async () => {
    const config = { type: "quotes", retry: { max: 5 } };
    const returning = vi.fn().mockResolvedValue([{ id: 7 }]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const selectWhere = vi.fn().mockResolvedValue([
      {
        url: "https://example.com/source",
        fetcherType: "quotes",
        urlLocked: false,
        config: { type: "quotes" }
      }
    ]);
    const from = vi.fn().mockReturnValue({ where: selectWhere });
    const db = {
      select: vi.fn().mockReturnValue({ from }),
      update: vi.fn().mockReturnValue({ set })
    } as unknown as DbClient;

    await updateSource(db, 7, { config });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        config,
        adminSnapshot: expect.objectContaining({
          queryChunks: expect.arrayContaining([JSON.stringify({ config })])
        })
      })
    );
  });

  it("does not write an admin snapshot for unrelated fields", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 7 }]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const db = {
      update: vi.fn().mockReturnValue({ set })
    } as unknown as DbClient;

    await updateSource(db, 7, { name: "Updated source" });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Updated source" })
    );
    expect(set.mock.calls[0]?.[0]).not.toHaveProperty("adminSnapshot");
  });

  it("rejects a partial update that would mismatch fetcherType and config.type", async () => {
    const selectWhere = vi.fn().mockResolvedValue([
      {
        url: "https://example.com/source",
        fetcherType: "rss",
        urlLocked: false,
        config: { type: "rss", url: "https://example.com/rss" }
      }
    ]);
    const from = vi.fn().mockReturnValue({ where: selectWhere });
    const db = {
      select: vi.fn().mockReturnValue({ from }),
      update: vi.fn()
    } as unknown as DbClient;

    await expect(
      updateSource(db, 7, {
        config: { type: "announcement", adapter: "nea-news" }
      })
    ).rejects.toBeInstanceOf(SourceFetcherConfigMismatchError);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("prevents ordinary updates from re-enabling or clearing a compliance block", async () => {
    const current = {
      url: "https://example.com/disallowed",
      fetcherType: "html",
      urlLocked: false,
      config: {
        type: "html",
        verificationBlocked: true,
        verificationBlockedReason: "robots.txt disallows target path"
      }
    };
    const selectWhere = vi.fn().mockResolvedValue([current]);
    const from = vi.fn().mockReturnValue({ where: selectWhere });
    const db = {
      select: vi.fn().mockReturnValue({ from }),
      update: vi.fn()
    } as unknown as DbClient;

    await expect(updateSource(db, 7, { enabled: true })).rejects.toBeInstanceOf(
      SourceVerificationPolicyError
    );
    await expect(
      updateSource(db, 7, {
        config: { type: "html", listUrl: current.url }
      })
    ).rejects.toBeInstanceOf(SourceVerificationPolicyError);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects changing a locked seed URL after its original URL was already changed", async () => {
    const selectWhere = vi.fn().mockResolvedValue([
      {
        url: "https://example.com/admin-edited-cu",
        urlLocked: true
      }
    ]);
    const from = vi.fn().mockReturnValue({ where: selectWhere });
    const db = {
      select: vi.fn().mockReturnValue({ from }),
      update: vi.fn()
    } as unknown as DbClient;

    await expect(
      updateSource(db, 7, { url: "https://example.com/cu-again" })
    ).rejects.toBeInstanceOf(ProtectedSourceUrlError);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("allows changing an ordinary source URL", async () => {
    const selectWhere = vi
      .fn()
      .mockResolvedValue([
        { url: "https://example.com/old", urlLocked: false }
      ]);
    const from = vi.fn().mockReturnValue({ where: selectWhere });
    const returning = vi
      .fn()
      .mockResolvedValue([{ id: 7, url: "https://example.com/new" }]);
    const updateWhere = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    const db = {
      select: vi.fn().mockReturnValue({ from }),
      update: vi.fn().mockReturnValue({ set })
    } as unknown as DbClient;

    const updated = await updateSource(db, 7, {
      url: "https://example.com/new"
    });

    expect(updated?.url).toBe("https://example.com/new");
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/new" })
    );
  });

  it("allows resubmitting the unchanged protected URL", async () => {
    const protectedUrl = "https://hq.smm.cn/h5/cu";
    const selectWhere = vi
      .fn()
      .mockResolvedValue([{ url: protectedUrl, urlLocked: true }]);
    const from = vi.fn().mockReturnValue({ where: selectWhere });
    const returning = vi.fn().mockResolvedValue([{ id: 7, url: protectedUrl }]);
    const updateWhere = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    const db = {
      select: vi.fn().mockReturnValue({ from }),
      update: vi.fn().mockReturnValue({ set })
    } as unknown as DbClient;

    await expect(
      updateSource(db, 7, { url: protectedUrl })
    ).resolves.toMatchObject({ url: protectedUrl });
    expect(db.update).toHaveBeenCalledOnce();
  });

  it("rejects enabling a locked SMM source when the same group is already enabled", async () => {
    const currentWhere = vi.fn().mockResolvedValue([
      {
        url: "https://example.com/admin-edited-cu",
        fetcherType: "quotes",
        urlLocked: true,
        config: { adapter: "smm-hq", metric_keys: ["cu_main_close"] }
      }
    ]);
    const siblingsWhere = vi.fn().mockResolvedValue([
      {
        id: 9,
        url: "https://example.com/other",
        fetcherType: "quotes",
        config: { adapter: "smm-hq", metric_keys: ["lc_main_close"] },
        enabled: true
      },
      {
        id: 11,
        url: "https://example.com/cu-copy",
        fetcherType: "quotes",
        config: { adapter: "smm-hq", metric_keys: ["cu_main_close"] },
        enabled: true
      },
      {
        id: 3,
        url: "https://hq.smm.cn/h5/cu",
        fetcherType: "quotes",
        config: {},
        enabled: true
      }
    ]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({ where: currentWhere })
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({ where: siblingsWhere })
        }),
      update: vi.fn()
    } as unknown as DbClient;

    const error = await updateSource(db, 7, { enabled: true }).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(DuplicateEnabledSourceError);
    expect(error).toMatchObject({
      code: "SOURCE_DUPLICATE_ENABLED",
      conflictingId: 3
    });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("allows enabling a locked SMM source when its sibling is disabled", async () => {
    const currentWhere = vi.fn().mockResolvedValue([
      {
        url: "https://example.com/admin-edited-cu",
        fetcherType: "quotes",
        urlLocked: true,
        config: { adapter: "smm-hq", metric_keys: ["cu_main_close"] }
      }
    ]);
    const siblingsWhere = vi.fn().mockResolvedValue([
      {
        id: 3,
        url: "https://hq.smm.cn/h5/cu",
        fetcherType: "quotes",
        config: {},
        enabled: false
      }
    ]);
    const returning = vi.fn().mockResolvedValue([{ id: 7, enabled: true }]);
    const updateWhere = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({ where: currentWhere })
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({ where: siblingsWhere })
        }),
      update: vi.fn().mockReturnValue({ set })
    } as unknown as DbClient;

    await expect(updateSource(db, 7, { enabled: true })).resolves.toMatchObject(
      { enabled: true }
    );
    expect(db.update).toHaveBeenCalledOnce();
  });

  it("does not apply the SMM sibling guard to an unrelated locked source", async () => {
    const currentWhere = vi.fn().mockResolvedValue([
      {
        url: "https://example.com/ordinary",
        fetcherType: "quotes",
        urlLocked: true,
        config: { adapter: "shfe", metric_keys: ["cu_main_close"] }
      }
    ]);
    const returning = vi.fn().mockResolvedValue([{ id: 7, enabled: true }]);
    const updateWhere = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: currentWhere })
      }),
      update: vi.fn().mockReturnValue({ set })
    } as unknown as DbClient;

    await expect(updateSource(db, 7, { enabled: true })).resolves.toMatchObject(
      { enabled: true }
    );
    expect(db.select).toHaveBeenCalledOnce();
    expect(db.update).toHaveBeenCalledOnce();
  });
});
