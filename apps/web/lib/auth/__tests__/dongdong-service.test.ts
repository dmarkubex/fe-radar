import { describe, expect, it } from "vitest";
import { isValidDongdongServiceKey } from "../dongdong-service";

describe("Dongdong service authentication", () => {
  it("accepts only the configured service key", () => {
    expect(isValidDongdongServiceKey("shared-secret", "shared-secret")).toBe(
      true
    );
    expect(isValidDongdongServiceKey("wrong", "shared-secret")).toBe(false);
    expect(isValidDongdongServiceKey(null, "shared-secret")).toBe(false);
  });
});
