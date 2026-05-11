import { describe, expect, it } from "vitest";
import { hasRole } from "../rbac";

describe("rbac", () => {
  it("allows higher roles to access lower gates", () => {
    expect(hasRole("admin", "viewer")).toBe(true);
    expect(hasRole("viewer", "admin")).toBe(false);
    expect(hasRole(undefined, "viewer")).toBe(false);
  });
});
