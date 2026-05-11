import { describe, expect, it } from "vitest";
import { feedbackSchema, searchQuerySchema, timelineQuerySchema } from "../../../../lib/api/timeline-schema";

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
    expect(timelineQuerySchema.parse({ includeBlocked: "false" }).includeBlocked).toBe(false);
    expect(timelineQuerySchema.parse({ curated: "false" }).curated).toBe(false);
  });

  it("requires search query text", () => {
    expect(searchQuerySchema.safeParse({ q: "远东", circle: "C2" }).success).toBe(true);
    expect(searchQuerySchema.safeParse({ q: "" }).success).toBe(false);
  });

  it("restricts feedback vote values", () => {
    expect(feedbackSchema.safeParse({ vote: 1, reason: "有价值" }).success).toBe(true);
    expect(feedbackSchema.safeParse({ vote: 2 }).success).toBe(false);
  });
});
