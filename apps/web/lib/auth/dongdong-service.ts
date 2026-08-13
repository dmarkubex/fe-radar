import { createHash, timingSafeEqual } from "node:crypto";
import { mergeOrCreateUser, UserDisabledError } from "@/lib/auth/merge";

import type { NextRequest } from "next/server";

function header(request: NextRequest, name: string, maxLength: number): string {
  const value = request.headers.get(name)?.trim() ?? "";
  return value.length <= maxLength ? value : "";
}

export function isValidDongdongServiceKey(
  provided: string | null,
  expected: string | undefined
): boolean {
  if (!provided || !expected) return false;
  const left = createHash("sha256").update(provided).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export async function authenticateDongdongRequest(request: NextRequest) {
  const expected = process.env.DONGDONG_INTEGRATION_SERVICE_KEY;
  if (!expected) {
    return {
      error: Response.json(
        { error: { code: "NOT_CONFIGURED", message: "东东办公集成未配置" } },
        { status: 503 }
      )
    };
  }
  if (
    !isValidDongdongServiceKey(
      request.headers.get("x-dongdong-service-key"),
      expected
    )
  ) {
    return {
      error: Response.json(
        { error: { code: "UNAUTHORIZED", message: "集成认证失败" } },
        { status: 401 }
      )
    };
  }
  const unionid = header(request, "x-dingtalk-union-id", 128);
  const name = header(request, "x-user-name", 100);
  const dept = header(request, "x-department", 200);
  if (!unionid || !name) {
    return {
      error: Response.json(
        { error: { code: "IDENTITY_REQUIRED", message: "缺少钉钉身份" } },
        { status: 400 }
      )
    };
  }
  try {
    return {
      user: await mergeOrCreateUser({ unionid, name, dept: dept || null })
    };
  } catch (error) {
    if (error instanceof UserDisabledError) {
      return {
        error: Response.json(
          { error: { code: "USER_DISABLED", message: "用户已禁用" } },
          { status: 403 }
        )
      };
    }
    return {
      error: Response.json(
        { error: { code: "IDENTITY_UNAVAILABLE", message: "身份服务不可用" } },
        { status: 503 }
      )
    };
  }
}
