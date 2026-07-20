import {
  DuplicateEnabledSourceError,
  getDb,
  ProtectedSourceUrlError,
  softDeleteSource,
  updateSource
} from "@fe-radar/db";
import { requireRequestRole } from "@/lib/api/authz";
import { updateSourceSchema, validationError } from "@/lib/api/sources-schema";
import { isMockMode } from "@/lib/mock-mode";
import { mockReadonlyResponse } from "@/lib/api/mock-readonly";

import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<Response> {
  const authError = await requireRequestRole(request, "editor");
  if (authError) return authError;

  const { id } = await context.params;
  const parsed = updateSourceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return validationError(parsed.error.flatten());
  }

  if (isMockMode()) {
    return mockReadonlyResponse();
  }

  let source;
  try {
    source = await updateSource(getDb(), Number(id), parsed.data);
  } catch (error) {
    if (error instanceof ProtectedSourceUrlError || error instanceof DuplicateEnabledSourceError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: 400 });
    }
    throw error;
  }
  if (!source) {
    return Response.json({ error: { code: "NOT_FOUND", message: "信源不存在" } }, { status: 404 });
  }
  return Response.json(source);
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  const authError = await requireRequestRole(request, "editor");
  if (authError) return authError;

  const { id } = await context.params;
  if (isMockMode()) {
    return mockReadonlyResponse();
  }
  const source = await softDeleteSource(getDb(), Number(id));
  if (!source) {
    return Response.json({ error: { code: "NOT_FOUND", message: "信源不存在" } }, { status: 404 });
  }
  return Response.json(source);
}
