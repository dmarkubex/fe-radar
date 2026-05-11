import { describe, expect, it } from "vitest";
import { decideMergeAction } from "../merge";

describe("merge decision tree", () => {
  it("returns existing when unionid already exists", () => {
    expect(decideMergeAction(true, 0)).toBe("existing");
  });

  it("auto merges exactly one name and dept candidate", () => {
    expect(decideMergeAction(false, 1)).toBe("auto_merge");
  });

  it("writes conflict and creates fallback user for duplicate candidates", () => {
    expect(decideMergeAction(false, 2)).toBe("conflict_new_user");
  });

  it("creates dingtalk-only user when there is no local candidate", () => {
    expect(decideMergeAction(false, 0)).toBe("new_user");
  });
});
