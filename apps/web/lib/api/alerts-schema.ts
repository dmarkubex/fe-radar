import { z } from "zod";

export const alertQuerySchema = z.object({
  type: z.enum(["own", "safety", "policy", "legal", "risk"]).optional(),
  level: z.enum(["L1", "L2", "L3"]).optional(),
  source: z.coerce.number().int().positive().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  range: z.enum(["24h", "7d", "all"]).default("24h")
});

export type AlertQuery = z.infer<typeof alertQuerySchema>;

export const dismissSchema = z.object({
  itemIds: z.array(z.coerce.number().int().positive()).min(1).max(200)
});

export type DismissBody = z.infer<typeof dismissSchema>;
