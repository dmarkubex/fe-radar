import { describe, expect, it } from "vitest";
import { getPoolSize } from "../client";

describe("db client configuration", () => {
  it("uses bounded pool sizes for web and worker", () => {
    expect(getPoolSize("web")).toBe(10);
    expect(getPoolSize("worker")).toBe(5);
  });
});
