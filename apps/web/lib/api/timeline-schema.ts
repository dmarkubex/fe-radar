import { z } from "zod";

const queryBoolean = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return value === true || value === "true";
}, z.boolean().optional());

export const timelineFilterSchema = z.object({
  category: z.string().min(1).optional(),
  circle: z.enum(["C1", "C2", "C3"]).optional(),
  tier: z.enum(["T1", "T2", "T3"]).optional(),
  eventType: z.string().min(1).optional(),
  alertType: z.enum(["own", "safety", "policy"]).optional(),
  curated: queryBoolean
});

export const timelineQuerySchema = timelineFilterSchema.extend({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  includeBlocked: queryBoolean.default(false)
});

export const searchQuerySchema = timelineQuerySchema.extend({
  q: z.string().trim().min(1).max(120)
});

export const feedbackSchema = z.object({
  vote: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  reason: z.string().trim().max(500).optional()
});

export type TimelineFilters = z.infer<typeof timelineFilterSchema>;
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
