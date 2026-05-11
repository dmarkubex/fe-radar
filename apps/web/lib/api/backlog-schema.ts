import { z } from "zod";

export const backlogQuerySchema = z.object({
  state: z.enum(["pending_over_quota", "dropped_quota_expired"]).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export type BacklogQuery = z.infer<typeof backlogQuerySchema>;
