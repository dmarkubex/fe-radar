import { z } from "zod";

const tierSchema = z.enum(["T1", "T2", "T3"]);
const fetcherTypeSchema = z.enum(["rss", "html", "playwright"]);

export const sourceConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("rss"),
    url: z.string().url()
  }),
  z.object({
    type: z.literal("html"),
    listUrl: z.string().url(),
    selectors: z.object({
      item: z.string().min(1),
      title: z.string().min(1),
      link: z.string().min(1),
      date: z.string().min(1),
      content: z.string().min(1).optional()
    }),
    useRealUa: z.boolean().optional()
  }),
  z.object({
    type: z.literal("playwright"),
    listUrl: z.string().url(),
    waitFor: z.string().min(1),
    extractor: z.string().startsWith("() =>"),
    useRealUa: z.boolean().optional()
  })
]);

const sourceBodySchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  fetcherType: fetcherTypeSchema,
  config: sourceConfigSchema,
  tier: tierSchema,
  category: z.string().min(1).nullable().optional(),
  enabled: z.boolean().optional()
});

function fetcherMatchesConfig(value: { fetcherType?: string; config?: { type: string } }): boolean {
  return !value.fetcherType || !value.config || value.fetcherType === value.config.type;
}

export const createSourceSchema = sourceBodySchema.refine(fetcherMatchesConfig, {
  message: "fetcherType must match config.type",
  path: ["fetcherType"]
});

export const updateSourceSchema = sourceBodySchema.partial().refine(fetcherMatchesConfig, {
  message: "fetcherType must match config.type",
  path: ["fetcherType"]
});

export function validationError(details: unknown): Response {
  return Response.json({ error: { code: "VALIDATION", message: "参数校验失败", details } }, { status: 400 });
}
