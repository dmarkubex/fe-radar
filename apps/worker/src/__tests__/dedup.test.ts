import { describe, expect, it } from "vitest";
import { dedupItems } from "../dedup";

describe("dedup", () => {
  it("skips duplicate url", () => {
    const result = dedupItems([{ sourceId: 1, url: "https://a", title: "A", content: "A", publishedAt: new Date("2026-05-11") }], [
      { sourceId: 1, url: "https://a", title: "Other", publishedDate: "2026-05-10" }
    ]);
    expect(result.skipped).toHaveLength(1);
  });

  it("skips same title and date in same source", () => {
    const result = dedupItems([{ sourceId: 1, url: "https://b", title: " A  B ", content: "A", publishedAt: new Date("2026-05-11") }], [
      { sourceId: 1, url: "https://a", title: "A B", publishedDate: "2026-05-11" }
    ]);
    expect(result.skipped).toHaveLength(1);
  });

  it("keeps same title and date across different sources", () => {
    const result = dedupItems([{ sourceId: 2, url: "https://b", title: "A", content: "A", publishedAt: new Date("2026-05-11") }], [
      { sourceId: 1, url: "https://a", title: "A", publishedDate: "2026-05-11" }
    ]);
    expect(result.accepted).toHaveLength(1);
  });
});
