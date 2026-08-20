import { getRequestUser, requireFreshRole, unauthorized } from "@/lib/api/authz";
import { copilotDisabled, evaluateCopilotAccess } from "@/lib/api/copilot-access";
import { webLogger } from "@/lib/logger";
import {
  COPILOT_BODY_LIMIT,
  isWhitelistedCopilotPath,
  maybeStubChat,
  proxyToCopilot
} from "../proxy";

import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function copilotPath(segments: string[]): string {
  return `/${segments.join("/")}`;
}

function payloadTooLarge(): Response {
  return Response.json(
    { error: { code: "PAYLOAD_TOO_LARGE", message: "请求体超过 32KiB" } },
    { status: 413 }
  );
}

function badRequest(): Response {
  return Response.json(
    { error: { code: "COPILOT_BAD_REQUEST", message: "请求体不是合法 JSON" } },
    { status: 400 }
  );
}

async function handle(
  request: NextRequest,
  segments: string[]
): Promise<Response> {
  const authError = await requireFreshRole(request, "viewer");
  if (authError) return authError;

  const path = copilotPath(segments);
  if (!isWhitelistedCopilotPath(request.method, path)) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "接口不存在" } },
      { status: 404 }
    );
  }

  const user = await getRequestUser(request);
  if (user.id === undefined || !user.role) {
    return unauthorized();
  }

  try {
    const enabled = await evaluateCopilotAccess(user.id);
    if (!enabled) return copilotDisabled();
  } catch (err) {
    webLogger.error({ err }, "evaluateCopilotAccess failed");
    return copilotDisabled();
  }

  const stub = maybeStubChat(request.method, path);
  if (stub) return stub;

  let raw = "";
  if (request.method === "POST") {
    raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > COPILOT_BODY_LIMIT) {
      return payloadTooLarge();
    }
    try {
      JSON.parse(raw);
    } catch {
      return badRequest();
    }
  }

  try {
    return await proxyToCopilot({
      request,
      method: request.method,
      path,
      raw,
      userId: user.id,
      role: user.role
    });
  } catch (err) {
    webLogger.error({ err }, "copilot HMAC or secret failed");
    return Response.json(
      { error: { code: "COPILOT_INTERNAL", message: "Copilot 内部配置失败" } },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const { path } = await params;
  return handle(request, path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const { path } = await params;
  return handle(request, path);
}
