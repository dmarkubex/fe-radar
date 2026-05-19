import crypto from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import { getDb, briefingTargets } from "@fe-radar/db";
import { getRequestUser, unauthorized, forbidden, notFound } from "@/lib/api/authz";

import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Sign webhook URL per design.md §10.2 */
function signWebhook(webhookUrl: string, signSecret: string): string {
  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${signSecret}`;
  const hmac = crypto
    .createHmac("sha256", signSecret)
    .update(stringToSign)
    .digest("base64");
  const sign = encodeURIComponent(hmac);
  return `${webhookUrl}&timestamp=${timestamp}&sign=${sign}`;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const user = await getRequestUser(request);
  if (!user.role) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const { id } = await context.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) return notFound();

  const db = getDb();
  const [target] = await db
    .select()
    .from(briefingTargets)
    .where(eq(briefingTargets.id, numId));

  if (!target || target.disabledAt !== null) return notFound();

  const targetUrl = target.signSecret
    ? signWebhook(target.webhookUrl, target.signSecret)
    : target.webhookUrl;

  try {
    const resp = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "text",
        text: { content: "[FE-Radar] 测试推送：推送目标配置验证成功。" }
      }),
      signal: AbortSignal.timeout(10_000)
    });

    const data = await resp.json() as { errcode?: number; errmsg?: string };
    if (data.errcode !== 0) {
      return Response.json(
        { ok: false, error: data.errmsg ?? "钉钉返回错误" },
        { status: 502 }
      );
    }
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "推送失败";
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
