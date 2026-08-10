import { inArray, sql } from "drizzle-orm";
import { getDb, itemAnalysis } from "@fe-radar/db";
import { requireFreshRole } from "@/lib/api/authz";
import { dismissSchema } from "@/lib/api/alerts-schema";

import type { NextRequest } from "next/server";

function getRowCount(result: unknown): number | null {
  if (typeof result !== "object" || result === null || !("rowCount" in result)) {
    return null;
  }
  return typeof result.rowCount === "number" ? result.rowCount : null;
}

export async function POST(request: NextRequest): Promise<Response> {
  const authError = await requireFreshRole(request, "editor");
  if (authError) return authError;

  const body = await request.json().catch(() => null);
  const parsed = dismissSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: "VALIDATION",
          message: "参数校验失败",
          details: parsed.error.flatten()
        }
      },
      { status: 400 }
    );
  }

  const { itemIds } = parsed.data;
  const result = await getDb()
    .update(itemAnalysis)
    .set({ alertDismissedAt: sql`now()` })
    .where(inArray(itemAnalysis.itemId, itemIds));

  return Response.json({ dismissed: getRowCount(result) ?? itemIds.length });
}
