import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import {
  getDb,
  briefingTargets,
  dailyPushConfig,
  dailyReports,
  commodityBriefings,
} from "@fe-radar/db";
import {
  buildDailyPushCard,
  hasDailyContent,
  type BriefingCardPayload,
  type DailyReportSections,
} from "@fe-radar/core";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";
import { getRequestUser, unauthorized, forbidden, notFound, requireFreshRole } from "@/lib/api/authz";

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

/**
 * POST test push — real merged ActionCard using today's data and schedule baseUrl.
 * Does NOT write daily_pushes audit rows (FR-10).
 */
export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const freshError = await requireFreshRole(request, "admin");
  if (freshError) return freshError;
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

  const [config] = await db
    .select({ baseUrl: dailyPushConfig.baseUrl })
    .from(dailyPushConfig)
    .where(eq(dailyPushConfig.id, 1))
    .limit(1);

  const baseUrl =
    config?.baseUrl ??
    process.env["INTRANET_URL"] ??
    process.env["NEXT_PUBLIC_APP_URL"] ??
    "http://fe-radar.internal";

  const reportDate = dayjs().tz(APP_TIMEZONE).format("YYYY-MM-DD");

  const [dailyRow] = await db
    .select({ sections: dailyReports.sections })
    .from(dailyReports)
    .where(eq(dailyReports.date, reportDate))
    .limit(1);

  const [briefingRow] = await db
    .select({
      id: commodityBriefings.id,
      genStatus: commodityBriefings.genStatus,
      payloadJson: commodityBriefings.payloadJson,
    })
    .from(commodityBriefings)
    .where(eq(commodityBriefings.briefingDate, reportDate))
    .limit(1);

  const dailyPresent = hasDailyContent(
    dailyRow?.sections as DailyReportSections | null | undefined
  );
  const briefingPushable =
    briefingRow != null &&
    (briefingRow.genStatus === "succeeded" || briefingRow.genStatus === "degraded");

  if (!dailyPresent && !briefingPushable) {
    return Response.json(
      {
        ok: false,
        error: "当日无产业日报且无可推送铜锂简报，无法发送测试 ActionCard",
      },
      { status: 422 }
    );
  }

  let card: { title: string; text: string; btns: Array<{ title: string; actionURL: string }> };
  try {
    card = buildDailyPushCard({
      reportDate,
      baseUrl,
      dailySections: dailyPresent ? (dailyRow!.sections as DailyReportSections) : null,
      briefing: briefingPushable
        ? {
            id: briefingRow!.id,
            genStatus: briefingRow!.genStatus,
            payload: briefingRow!.payloadJson as BriefingCardPayload,
          }
        : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "卡片构造失败";
    return Response.json({ ok: false, error: message }, { status: 400 });
  }

  const targetUrl = target.signSecret
    ? signWebhook(target.webhookUrl, target.signSecret)
    : target.webhookUrl;

  try {
    const resp = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "actionCard",
        actionCard: {
          title: card.title,
          text: card.text,
          btnOrientation: "0",
          btns: card.btns.map((b) => ({ title: b.title, actionURL: b.actionURL })),
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await resp.json()) as { errcode?: number; errmsg?: string };
    if (data.errcode !== 0) {
      return Response.json(
        { ok: false, error: data.errmsg ?? "钉钉返回错误" },
        { status: 502 }
      );
    }
    // Return non-secret payload for UI / tests; never include webhook/signSecret.
    return Response.json({
      ok: true,
      card: {
        title: card.title,
        btnTitles: card.btns.map((b) => b.title),
        // paths only — full URLs use configured baseUrl but not secrets
        actionPaths: card.btns.map((b) => {
          try {
            return new URL(b.actionURL).pathname + new URL(b.actionURL).search;
          } catch {
            return b.actionURL;
          }
        }),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "推送失败";
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
