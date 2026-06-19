import { describe, expect, it } from "vitest";
import {
  feedbackSchema,
  normalizeTimelineFilters,
  searchQuerySchema,
  timelineQuerySchema
} from "../../../../lib/api/timeline-schema";

describe("timeline api schema", () => {
  it("accepts multi-dimensional filters and keeps includeBlocked explicit", () => {
    const parsed = timelineQuerySchema.parse({
      circle: "C1",
      tier: "T1",
      alertType: "own",
      includeBlocked: "true"
    });

    expect(parsed).toMatchObject({
      circle: "C1",
      tier: "T1",
      alertType: "own",
      includeBlocked: true
    });
  });

  it("does not coerce string false to true", () => {
    expect(
      timelineQuerySchema.parse({ includeBlocked: "false" }).includeBlocked
    ).toBe(false);
    expect(timelineQuerySchema.parse({ curated: "false" }).curated).toBe(false);
  });

  it("requires search query text", () => {
    expect(
      searchQuerySchema.safeParse({ q: "远东", circle: "C2" }).success
    ).toBe(true);
    expect(searchQuerySchema.safeParse({ q: "" }).success).toBe(false);
  });

  it("maps curated English slugs to Chinese DB categories only for curated filters", () => {
    expect(
      normalizeTimelineFilters({ curated: true, category: "policy" })
    ).toMatchObject({
      curated: true,
      category: "政策与标准"
    });
    expect(normalizeTimelineFilters({ category: "policy" })).toMatchObject({
      category: "policy"
    });
  });

  it("restricts feedback vote values", () => {
    expect(
      feedbackSchema.safeParse({ vote: 1, reason: "有价值" }).success
    ).toBe(true);
    expect(feedbackSchema.safeParse({ vote: 2 }).success).toBe(false);
  });
});
