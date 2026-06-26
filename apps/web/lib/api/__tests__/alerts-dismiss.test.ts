import { describe, expect, it } from "vitest";
import { itemAnalysis } from "@fe-radar/db";

import { dismissSchema } from "../alerts-schema";

describe("dismissSchema", () => {
  it("accepts valid itemIds", () => {
    expect(() => dismissSchema.parse({ itemIds: [1, 2, 3] })).not.toThrow();
  });

  it("rejects empty array", () => {
    expect(() => dismissSchema.parse({ itemIds: [] })).toThrow();
  });

  it("rejects array longer than 200", () => {
    expect(() =>
      dismissSchema.parse({
        itemIds: Array.from({ length: 201 }, (_, index) => index + 1)
      })
    ).toThrow();
  });

  it("rejects non-positive integers", () => {
    expect(() => dismissSchema.parse({ itemIds: [0] })).toThrow();
    expect(() => dismissSchema.parse({ itemIds: [-1] })).toThrow();
  });

  it("rejects non-numeric strings", () => {
    expect(() => dismissSchema.parse({ itemIds: ["abc"] })).toThrow();
  });
});

describe("itemAnalysis schema includes alertDismissedAt", () => {
  it("has alertDismissedAt column defined", () => {
    expect(itemAnalysis.alertDismissedAt).toBeDefined();
  });
});
