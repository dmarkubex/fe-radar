import { describe, expect, it } from "vitest";
import { mergeConflictActionSchema, updateUserSchema } from "../../../../lib/api/users-schema";

describe("users api schema", () => {
  it("accepts role updates and soft delete flags", () => {
    expect(updateUserSchema.safeParse({ role: "editor", disabled: true }).success).toBe(true);
  });

  it("requires targetUserId for merge confirm", () => {
    expect(mergeConflictActionSchema.safeParse({ action: "confirm" }).success).toBe(false);
    expect(mergeConflictActionSchema.safeParse({ action: "confirm", targetUserId: 1 }).success).toBe(true);
  });
});
