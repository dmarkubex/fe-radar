import { describe, expect, it } from "vitest";
import { BCRYPT_WORK_FACTOR, hashPassword, verifyPassword } from "../password";

describe("password helpers", () => {
  it("hashes with bcrypt work factor 12 and verifies", async () => {
    const hash = await hashPassword("secret");
    expect(hash.startsWith("$2")).toBe(true);
    expect(hash.split("$")[2]).toBe(String(BCRYPT_WORK_FACTOR));
    await expect(verifyPassword("secret", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });
});
