import { getDb, scoringConfig } from "@fe-radar/db";
import { getRequestUser } from "@/lib/api/authz";
import { scoringConfigSchema, validationError } from "@/lib/api/scoring-config-schema";
import { isMockMode } from "@/lib/mock-mode";
import { mockScoringConfig } from "@/lib/mock-data";
import { mockReadonlyResponse } from "@/lib/api/mock-readonly";

import type { NextRequest } from "next/server";

const KEY_MAP = {
  weights: "weights",
  tCoef: "t_coef",
  cCoef: "c_coef",
  thresholds: "thresholds"
} as const;

export async function GET(): Promise<Response> {
  if (isMockMode()) {
    return Response.json(mockScoringConfig);
  }
  const rows = await getDb().select().from(scoringConfig);
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return Response.json({
    weights: byKey.weights,
    tCoef: byKey.t_coef,
    cCoef: byKey.c_coef,
    thresholds: byKey.thresholds
  });
}

export async function PUT(request: NextRequest): Promise<Response> {
  const user = await getRequestUser(request);
  const parsed = scoringConfigSchema.safeParse(await request.json());
  if (!parsed.success) {
    return validationError(parsed.error.flatten());
  }

  if (isMockMode()) {
    return mockReadonlyResponse();
  }

  const db = getDb();
  await db.transaction(async (tx) => {
    for (const [field, key] of Object.entries(KEY_MAP)) {
      await tx
        .insert(scoringConfig)
        .values({
          key,
          value: parsed.data[field as keyof typeof KEY_MAP],
          updatedBy: user.id
        })
        .onConflictDoUpdate({
          target: scoringConfig.key,
          set: {
            value: parsed.data[field as keyof typeof KEY_MAP],
            updatedAt: new Date(),
            updatedBy: user.id
          }
        });
    }
  });

  return Response.json(parsed.data);
}
