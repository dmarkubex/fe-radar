import { eq } from "drizzle-orm";
import { Client as MinioClient } from "minio";
import { getDb, commodityBriefings } from "@fe-radar/db";
import { dayjs, APP_TIMEZONE } from "@fe-radar/shared";
import { getRequestUser } from "@/lib/api/authz";
import { requireFreshViewer } from "@/lib/auth/token-freshness";

import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// MinIO client — created per-request (stateless, mirrors briefing-render.ts)
// ---------------------------------------------------------------------------

function createMinioClient(): MinioClient {
  const endpoint = process.env["MINIO_ENDPOINT"] ?? "minio";
  const port = parseInt(process.env["MINIO_PORT"] ?? "9000", 10);
  const useSSL = process.env["MINIO_USE_SSL"] === "true";
  const accessKey = process.env["MINIO_ACCESS_KEY"] ?? "";
  const secretKey = process.env["MINIO_SECRET_KEY"] ?? "";

  return new MinioClient({
    endPoint: endpoint,
    port,
    useSSL,
    accessKey,
    secretKey
  });
}

// ---------------------------------------------------------------------------
// FR-110: 90-day retention check
// briefing_date < now - 90d → 410 Gone
// ---------------------------------------------------------------------------

const RETENTION_DAYS = 90;

function isExpired(briefingDate: string): boolean {
  const cutoff = dayjs().tz(APP_TIMEZONE).subtract(RETENTION_DAYS, "day").startOf("day");
  return dayjs(briefingDate).tz(APP_TIMEZONE).isBefore(cutoff);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const freshError = await requireFreshViewer(request);
  if (freshError) return freshError;

  const user = await getRequestUser(request);
  if (!user.role) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "请先登录" } }, { status: 401 });
  }

  const { id } = await context.params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return Response.json({ error: { code: "NOT_FOUND", message: "条目不存在或不可访问" } }, { status: 404 });
  }

  const db = getDb();
  const [briefing] = await db
    .select()
    .from(commodityBriefings)
    .where(eq(commodityBriefings.id, numId))
    .limit(1);

  // briefing does not exist → 404 (防枚举：不区分"不存在"和"已清")
  if (!briefing) {
    return Response.json({ error: { code: "NOT_FOUND", message: "条目不存在或不可访问" } }, { status: 404 });
  }

  // FR-110: briefing_date < now-90d → 410 Gone
  if (isExpired(briefing.briefingDate)) {
    return Response.json(
      { error: { code: "BRIEFING_DOCX_EXPIRED", message: "简报已过保留期" } },
      { status: 410 }
    );
  }

  // No docx path stored
  if (!briefing.docxPath) {
    return Response.json(
      { error: { code: "BRIEFING_DOCX_EXPIRED", message: "简报已过保留期" } },
      { status: 410 }
    );
  }

  // Resolve bucket / key from docx_path: format is "{bucket}/{key}"
  const bucket = process.env["BRIEFING_MINIO_BUCKET"] ?? "fe-radar-briefings";
  // docxPath stored as "{bucket}/{minioKey}" by briefing-render.ts
  const minioKey = briefing.docxPath.startsWith(`${bucket}/`)
    ? briefing.docxPath.slice(bucket.length + 1)
    : briefing.docxPath;

  const minio = createMinioClient();

  // MinIO headObject — if the object no longer exists → 410 Gone (FR-110)
  try {
    await minio.statObject(bucket, minioKey);
  } catch {
    return Response.json(
      { error: { code: "BRIEFING_DOCX_EXPIRED", message: "简报已过保留期" } },
      { status: 410 }
    );
  }

  // Stream the docx back to the client
  try {
    const stream = await minio.getObject(bucket, minioKey);

    const filename = minioKey.split("/").pop() ?? `briefing-${briefing.briefingDate}.docx`;

    // Collect stream into buffer for Next.js Response
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    const body = Buffer.concat(chunks);

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(body.length),
        "Cache-Control": "private, no-store"
      }
    });
  } catch {
    return Response.json(
      { error: { code: "BRIEFING_DOCX_EXPIRED", message: "简报已过保留期" } },
      { status: 410 }
    );
  }
}
