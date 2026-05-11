import { z } from "zod";

export const updateUserSchema = z.object({
  role: z.enum(["viewer", "editor", "admin"]).optional(),
  disabled: z.boolean().optional()
});

export const mergeConflictActionSchema = z.object({
  action: z.enum(["confirm", "reject"]),
  targetUserId: z.coerce.number().int().positive().optional()
}).refine((value) => value.action !== "confirm" || Boolean(value.targetUserId), {
  message: "confirm 需要 targetUserId",
  path: ["targetUserId"]
});

export function validationError(details: unknown): Response {
  return Response.json({ error: { code: "VALIDATION", message: "参数校验失败", details } }, { status: 400 });
}
