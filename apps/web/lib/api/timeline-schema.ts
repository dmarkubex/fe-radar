import { z } from "zod";

export const CURATED_CATEGORY_OPTIONS = [
  { slug: "policy", label: "政策与标准", dbCategory: "政策与标准" },
  { slug: "market", label: "市场与价格", dbCategory: "市场与价格" },
  { slug: "tech", label: "技术与产品", dbCategory: "技术与产品" },
  { slug: "project", label: "项目与招投标", dbCategory: "项目与招投标" },
  { slug: "company", label: "公司与资本", dbCategory: "公司与资本" }
] as const;

export const CURATED_CATEGORY_DB_CATEGORY = Object.fromEntries(
  CURATED_CATEGORY_OPTIONS.map((category) => [
    category.slug,
    category.dbCategory
  ])
) as Record<(typeof CURATED_CATEGORY_OPTIONS)[number]["slug"], string>;

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
  alertType: z.enum(["own", "safety", "policy", "legal", "risk"]).optional(),
  curated: queryBoolean
});

export const timelineQuerySchema = timelineFilterSchema.extend({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  includeBlocked: queryBoolean.default(false),
  includeNonIndustry: queryBoolean.default(false)
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

export function resolveCuratedCategory(
  category: string | undefined
): string | undefined {
  if (!category) {
    return undefined;
  }
  return (
    CURATED_CATEGORY_DB_CATEGORY[
      category as keyof typeof CURATED_CATEGORY_DB_CATEGORY
    ] ?? category
  );
}

export function normalizeTimelineFilters(
  filters: TimelineFilters
): TimelineFilters {
  if (!filters.curated || !filters.category) {
    return filters;
  }
  return { ...filters, category: resolveCuratedCategory(filters.category) };
}

export function resolveAcquisitionLabel(
  fetcherType: string | null,
  sourceCategory: string | null
): string | null {
  if (sourceCategory === "风险检索") {
    return "AI检索摘要";
  }
  if (fetcherType === "crawl") {
    return "AI获取";
  }
  return null;
}
