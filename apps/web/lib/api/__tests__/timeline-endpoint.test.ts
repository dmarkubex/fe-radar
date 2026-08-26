import { describe, expect, it } from "vitest";

import { buildTimelineEndpoint, canFetchTimeline } from "../timeline-endpoint";

describe("buildTimelineEndpoint", () => {
  it("builds the home timeline URL from filter chips", () => {
    const params = new URLSearchParams("circle=C1&tier=T1");
    expect(buildTimelineEndpoint("/", params)).toBe("/api/timeline?circle=C1&tier=T1");
  });

  it("uses /api/search when q is set on /items", () => {
    const params = new URLSearchParams("q=电缆&alertType=own");
    expect(buildTimelineEndpoint("/items", params)).toBe(
      "/api/search?q=%E7%94%B5%E7%BC%86&alertType=own"
    );
  });

  it("keeps /api/search on the search page even without extra filters", () => {
    const params = new URLSearchParams("q=铜");
    expect(buildTimelineEndpoint("/search", params)).toBe("/api/search?q=%E9%93%9C");
  });

  it("drops blank q and unused keys", () => {
    const params = new URLSearchParams("q=&circle=");
    expect(buildTimelineEndpoint("/items", params)).toBe("/api/timeline");
  });

  it("does not fetch /api/search until q is present", () => {
    expect(canFetchTimeline("/api/search")).toBe(false);
    expect(canFetchTimeline("/api/search?q=")).toBe(false);
    expect(canFetchTimeline("/api/search?q=%E7%94%B5%E7%BC%86")).toBe(true);
    expect(canFetchTimeline("/api/timeline")).toBe(true);
  });
});
