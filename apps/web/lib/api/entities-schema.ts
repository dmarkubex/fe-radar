import { z } from "zod";

const entityBaseSchema = z.object({
  type: z.string().min(1),
  canonicalName: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  circle: z.enum(["C1", "C2", "C3"]).nullable().optional(),
  weight: z.coerce.number().min(0).max(100).default(1)
});

export const entityBodySchema = entityBaseSchema.refine((value) => value.type === "company" || !value.circle, {
  message: "circle 仅允许 company 类型填写",
  path: ["circle"]
});

export const updateEntitySchema = entityBaseSchema.partial().refine((value) => !value.circle || value.type === "company", {
  message: "circle 仅允许 company 类型填写",
  path: ["circle"]
});

export function validationError(details: unknown): Response {
  return Response.json({ error: { code: "VALIDATION", message: "参数校验失败", details } }, { status: 400 });
}
