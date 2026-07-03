import { handlers } from "@/auth";
import { normalizeDingtalkCallbackUrl } from "@/lib/auth/dingtalk-callback";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest): Promise<Response> {
  const normalizedUrl = normalizeDingtalkCallbackUrl(request.url);
  if (normalizedUrl === request.url) {
    return handlers.GET(request);
  }
  return handlers.GET(new NextRequest(normalizedUrl, { headers: request.headers, method: request.method }));
}

export const { POST } = handlers;
