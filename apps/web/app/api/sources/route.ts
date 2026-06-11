import { createSource, getDb, listSources } from "@fe-radar/db";
import { requireRequestRole } from "@/lib/api/authz";
import { createSourceSchema, validationError } from "@/lib/api/sources-schema";
import { isMockMode } from "@/lib/mock-mode";
import { mockSources } from "@/lib/mock-data";
import { mockReadonlyResponse } from "@/lib/api/mock-readonly";

import type { NextRequest } from "next/server";

export async function GET(request: NextRequest): Promise<Response> {
  const authError = await requireRequestRole(request, "editor");
  if (authError) return authError;

  if (isMockMode()) {
    return Response.json({ items: mockSources, nextCursor: null });
  }
  const { searchParams } = new URL(request.url);
  const tier = searchParams.get("tier") ?? undefined;
  const category = searchParams.get("category") ?? undefined;
  const enabledParam = searchParams.get("enabled");
  const enabled = enabledParam === null ? undefined : enabledParam === "true";
  const items = await listSources(getDb(), {
    tier: tier === "T1" || tier === "T2" || tier === "T3" ? tier : undefined,
    category,
    enabled
  });
  return Response.json({ items, nextCursor: null });
}

export async function POST(request: NextRequest): Promise<Response> {
  const authError = await requireRequestRole(request, "editor");
  if (authError) return authError;

  const parsed = createSourceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return validationError(parsed.error.flatten());
  }

  if (isMockMode()) {
    return mockReadonlyResponse();
  }

  const source = await createSource(getDb(), parsed.data);
  return Response.json(source, { status: 201 });
}
