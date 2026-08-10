/**
 * S4 / T-SEC-09: project_codes 字典 admin CRUD。
 * 供运维维护 scrubber 项目代号（真实代号 → 出网前替换为 [REDACTED:PROJECT_CODE:…]）。
 * UI 本批不做；runbook 写明 curl / 调用方式。
 */
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, projectCodes } from "@fe-radar/db";
import { requireFreshRole } from "@/lib/api/authz";

import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  code: z.string().trim().min(1).max(200),
  note: z.string().trim().max(1000).optional().nullable()
});

const updateSchema = z.object({
  id: z.coerce.number().int().positive(),
  code: z.string().trim().min(1).max(200).optional(),
  note: z.string().trim().max(1000).optional().nullable(),
  /** true → 清除 disabled_at；false → 软删（disabled_at=now） */
  enabled: z.boolean().optional()
});

function validationError(details: unknown): Response {
  return Response.json({ error: { code: "VALIDATION", message: "参数校验失败", details } }, { status: 400 });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

export async function GET(request: NextRequest): Promise<Response> {
  const authError = await requireFreshRole(request, "admin");
  if (authError) return authError;

  const rows = await getDb()
    .select({
      id: projectCodes.id,
      code: projectCodes.code,
      note: projectCodes.note,
      disabledAt: projectCodes.disabledAt,
      createdAt: projectCodes.createdAt
    })
    .from(projectCodes)
    .orderBy(desc(projectCodes.id));

  return Response.json({ items: rows });
}

export async function POST(request: NextRequest): Promise<Response> {
  const authError = await requireFreshRole(request, "admin");
  if (authError) return authError;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return validationError(parsed.error.flatten());
  }

  try {
    const [created] = await getDb()
      .insert(projectCodes)
      .values({
        code: parsed.data.code,
        note: parsed.data.note ?? null
      })
      .returning({
        id: projectCodes.id,
        code: projectCodes.code,
        note: projectCodes.note,
        disabledAt: projectCodes.disabledAt,
        createdAt: projectCodes.createdAt
      });

    return Response.json(created, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return Response.json(
        { error: { code: "CODE_TAKEN", message: "项目代号已存在" } },
        { status: 409 }
      );
    }
    throw err;
  }
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const authError = await requireFreshRole(request, "admin");
  if (authError) return authError;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return validationError(parsed.error.flatten());
  }

  const { id, code, note, enabled } = parsed.data;
  if (code === undefined && note === undefined && enabled === undefined) {
    return validationError({ formErrors: ["至少提供 code / note / enabled 之一"], fieldErrors: {} });
  }

  const patch: {
    code?: string;
    note?: string | null;
    disabledAt?: Date | null;
  } = {};
  if (code !== undefined) patch.code = code;
  if (note !== undefined) patch.note = note;
  if (enabled === true) patch.disabledAt = null;
  if (enabled === false) patch.disabledAt = new Date();

  try {
    const [updated] = await getDb()
      .update(projectCodes)
      .set(patch)
      .where(eq(projectCodes.id, id))
      .returning({
        id: projectCodes.id,
        code: projectCodes.code,
        note: projectCodes.note,
        disabledAt: projectCodes.disabledAt,
        createdAt: projectCodes.createdAt
      });

    if (!updated) {
      return Response.json({ error: { code: "NOT_FOUND", message: "项目代号不存在" } }, { status: 404 });
    }
    return Response.json(updated);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return Response.json(
        { error: { code: "CODE_TAKEN", message: "项目代号已存在" } },
        { status: 409 }
      );
    }
    throw err;
  }
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const authError = await requireFreshRole(request, "admin");
  if (authError) return authError;

  const idRaw = new URL(request.url).searchParams.get("id");
  const id = idRaw ? Number(idRaw) : NaN;
  if (!Number.isInteger(id) || id <= 0) {
    return validationError({ formErrors: ["query id 必须为正整数"], fieldErrors: { id: ["required"] } });
  }

  const [updated] = await getDb()
    .update(projectCodes)
    .set({ disabledAt: new Date() })
    .where(eq(projectCodes.id, id))
    .returning({
      id: projectCodes.id,
      code: projectCodes.code,
      note: projectCodes.note,
      disabledAt: projectCodes.disabledAt,
      createdAt: projectCodes.createdAt
    });

  if (!updated) {
    return Response.json({ error: { code: "NOT_FOUND", message: "项目代号不存在" } }, { status: 404 });
  }
  return Response.json(updated);
}
