import { describe, expect, it } from "vitest";
import {
  lockedBadgeLabel,
  lockedEnableError,
  lockedSiblingMeta,
  smmLogicalKey,
  type SourceRow,
} from "../source-table-locked-meta";

function source(id: number, enabled: boolean): SourceRow {
  return {
    id,
    name: `SMM 铜行情 #${id}`,
    url: `https://example.test/smm-cu-${id}`,
    urlLocked: true,
    fetcherType: "quotes",
    config: { adapter: "smm-hq", metric_keys: ["cu_main_close"] },
    tier: "T1",
    category: "commodity",
    enabled,
    lastOkAt: null,
    failCount: 0,
  };
}

describe("URL-locked source sibling metadata", () => {
  it("A: keeps the smaller enabled row canonical and blocks its disabled sibling", () => {
    const rows = [source(10, true), source(20, false)];

    expect(smmLogicalKey(rows[0]!)).toBe("cu");
    expect(lockedSiblingMeta(rows[0]!, rows)).toEqual({
      isDuplicate: false,
      canonicalId: 10,
      siblingEnabled: false,
    });
    expect(lockedSiblingMeta(rows[1]!, rows)).toEqual({
      isDuplicate: true,
      canonicalId: 10,
      siblingEnabled: true,
    });
    expect(lockedBadgeLabel(rows[0]!, rows)).toBe("URL锁定·当前启用");
    expect(lockedBadgeLabel(rows[1]!, rows)).toBe("URL锁定·同行副本");
    expect(lockedEnableError(rows[1]!, rows)).toContain("请先停用另一行");
  });

  it("B: falls back to the smaller id when all rows are disabled but allows either row", () => {
    const rows = [source(10, false), source(20, false)];

    expect(lockedSiblingMeta(rows[1]!, rows)).toEqual({
      isDuplicate: true,
      canonicalId: 10,
      siblingEnabled: false,
    });
    expect(lockedEnableError(rows[0]!, rows)).toBeNull();
    expect(lockedEnableError(rows[1]!, rows)).toBeNull();
    expect(lockedBadgeLabel(rows[0]!, rows)).toBe("URL锁定·默认行");
    expect(lockedBadgeLabel(rows[1]!, rows)).toBe("URL锁定·同行副本");
  });

  it("C: treats the larger enabled row as canonical and blocks the smaller sibling", () => {
    const rows = [source(10, false), source(20, true)];

    expect(lockedSiblingMeta(rows[1]!, rows)).toEqual({
      isDuplicate: false,
      canonicalId: 20,
      siblingEnabled: false,
    });
    expect(lockedSiblingMeta(rows[0]!, rows)).toEqual({
      isDuplicate: true,
      canonicalId: 20,
      siblingEnabled: true,
    });
    expect(lockedBadgeLabel(rows[1]!, rows)).toBe("URL锁定·当前启用");
    expect(lockedEnableError(rows[0]!, rows)).toContain("请先停用另一行");
  });

  it("D: allows switching from the smaller row to the larger row after disabling it", () => {
    const initial = [source(10, true), source(20, false)];
    expect(lockedEnableError(initial[1]!, initial)).not.toBeNull();

    const afterDisable = [source(10, false), source(20, false)];
    expect(lockedEnableError(afterDisable[1]!, afterDisable)).toBeNull();

    const afterEnable = [source(10, false), source(20, true)];
    expect(lockedSiblingMeta(afterEnable[1]!, afterEnable).canonicalId).toBe(20);
  });

  it("defensively chooses the smallest id when multiple siblings are enabled", () => {
    const rows = [source(20, true), source(10, true), source(30, false)];

    expect(lockedSiblingMeta(rows[0]!, rows).canonicalId).toBe(10);
    expect(lockedSiblingMeta(rows[1]!, rows).canonicalId).toBe(10);
    expect(lockedSiblingMeta(rows[2]!, rows).canonicalId).toBe(10);
  });

  it("does not group a locked non-SMM adapter by metric key alone", () => {
    const smm = source(10, true);
    const shfe = {
      ...source(20, false),
      config: { adapter: "shfe", metric_keys: ["cu_main_close"] },
    };

    expect(smmLogicalKey(shfe)).toBeNull();
    expect(lockedSiblingMeta(shfe, [smm, shfe])).toEqual({
      isDuplicate: false,
      canonicalId: null,
      siblingEnabled: false,
    });
    expect(lockedEnableError(shfe, [smm, shfe])).toBeNull();
  });
});
