import { describe, expect, it } from "vitest";
import { safeExternalUrl, safeItemHref } from "./safe-external-url";

describe("safeExternalUrl", () => {
  it("only allows HTTP(S) links", () => {
    expect(safeExternalUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeExternalUrl("http://example.com")).toBe("http://example.com/");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("/relative")).toBeNull();
  });
});

describe("safeItemHref", () => {
  it("allows controlled item routes and HTTP(S), but rejects other URLs", () => {
    expect(safeItemHref("/items/42")).toBe("/items/42");
    expect(safeItemHref("https://example.com/item")).toBe("https://example.com/item");
    expect(safeItemHref("http://example.com/item")).toBe("http://example.com/item");
    expect(safeItemHref("javascript:alert(1)")).toBeNull();
    expect(safeItemHref("/admin/users")).toBeNull();
    expect(safeItemHref("/items/not-a-number")).toBeNull();
  });
});
