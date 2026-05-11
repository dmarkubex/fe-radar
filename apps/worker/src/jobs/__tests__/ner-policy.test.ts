import { describe, expect, it } from "vitest";
import { detectPolicyEntities } from "../../lib/entities-dict";

describe("NER policy regex", () => {
  it("detects GB/T and NB/T standard numbers", () => {
    expect(detectPolicyEntities("GB/T 12706-2020 与 NB/T 31089")).toEqual([
      { type: "policy", span: "GB/T 12706-2020" },
      { type: "policy", span: "NB/T 31089" }
    ]);
  });
});
