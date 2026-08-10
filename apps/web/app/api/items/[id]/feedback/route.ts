import { feedbacks, getDb } from "@fe-radar/db";
import { getRequestUser, notFound, unauthorized } from "@/lib/api/authz";
import { requireFreshViewer } from "@/lib/auth/token-freshness";
import { feedbackSchema } from "@/lib/api/timeline-schema";
import { fetchItemDetail } from "@/lib/api/timeline-query";

import type { NextRequest } from "next/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const freshError = await requireFreshViewer(request);
  if (freshError) return freshError;

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

  // T-SEC-14: 复用详情可见性闸门（含 quota-blocked / 未评分 / 人工脱敏 过滤），
  // 不可见与不存在返回同一 404，避免成为隐藏条目的存在性 oracle。原代码只查裸 items.id。
  const item = await fetchItemDetail(itemId, { includeBlocked: false });
  if (!item) {
    return notFound();
  }
  void item; // 仅做可见性校验，feedback 写入不需要 item 内容。

  const db = getDb();

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
