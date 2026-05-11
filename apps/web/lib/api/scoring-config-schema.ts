import { z } from "zod";

export const scoringConfigSchema = z.object({
  weights: z.object({
    w1: z.coerce.number().min(0).max(1),
    w2: z.coerce.number().min(0).max(1),
    w3: z.coerce.number().min(0).max(1),
    w4: z.coerce.number().min(0).max(1),
    w5: z.coerce.number().min(0).max(1)
  }),
  tCoef: z.object({
    T1: z.coerce.number().min(0).max(2),
    T2: z.coerce.number().min(0).max(2),
    T3: z.coerce.number().min(0).max(2)
  }),
  cCoef: z.object({
    C1: z.coerce.number().min(0).max(2),
    C2: z.coerce.number().min(0).max(2),
    C3: z.coerce.number().min(0).max(2)
  }),
  thresholds: z.record(z.string(), z.object({
    C1: z.coerce.number().min(0).max(100),
    C2: z.coerce.number().min(0).max(100),
    C3: z.coerce.number().min(0).max(100)
  }))
}).refine((value) => Math.abs(Object.values(value.weights).reduce((sum, current) => sum + current, 0) - 1) < 0.0001, {
  message: "权重和必须为 1.00",
  path: ["weights"]
});

export type ScoringConfigBody = z.infer<typeof scoringConfigSchema>;

export function validationError(details: unknown): Response {
  return Response.json({ error: { code: "VALIDATION", message: "参数校验失败", details } }, { status: 400 });
}
