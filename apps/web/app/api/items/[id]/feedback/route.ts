import { eq } from "drizzle-orm";
import { feedbacks, getDb, items } from "@fe-radar/db";
import { getRequestUser, notFound, unauthorized } from "@/lib/api/authz";
import { feedbackSchema } from "@/lib/api/timeline-schema";

import type { NextRequest } from "next/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getRequestUser(request);
  if (!user.id) {
    return unauthorized();
  }

  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return notFound();
  }

  const parsed = feedbackSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "参数错误", details: parsed.error.flatten() } }, { status: 400 });
  }

  const db = getDb();
  const exists = await db.select({ id: items.id }).from(items).where(eq(items.id, itemId)).limit(1);
  if (!exists[0]) {
    return notFound();
  }

  const [feedback] = await db
    .insert(feedbacks)
    .values({
      itemId,
      userId: user.id,
      vote: parsed.data.vote,
      reason: parsed.data.reason
    })
    .onConflictDoUpdate({
      target: [feedbacks.itemId, feedbacks.userId],
      set: {
        vote: parsed.data.vote,
        reason: parsed.data.reason
      }
    })
    .returning();

  return Response.json({ feedback });
}
