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

export const createUserSchema = z.object({
  username: z.string().trim().min(3, "用户名至少 3 个字符"),
  password: z.string().min(8, "密码至少 8 个字符"),
  name: z.string().trim().min(1, "姓名不能为空"),
  dept: z.string().optional(),
  role: z.enum(["viewer", "editor", "admin"]).default("viewer")
});
