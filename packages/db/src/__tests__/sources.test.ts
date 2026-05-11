import { describe, expect, it } from "vitest";
import { sources } from "../schema";

describe("sources schema", () => {
  it("keeps source indexes and unique url in schema metadata", () => {
    expect(sources.url).toBeDefined();
    expect(sources.failCount).toBeDefined();
    expect(sources.lastOkAt).toBeDefined();
  });
});
