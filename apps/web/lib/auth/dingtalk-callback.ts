export function normalizeDingtalkCallbackUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (!url.pathname.endsWith("/api/auth/callback/dingtalk")) {
    return rawUrl;
  }

  const authCode = url.searchParams.get("authCode");
  if (!authCode || url.searchParams.has("code")) {
    return rawUrl;
  }

  url.searchParams.set("code", authCode);
  return url.toString();
}
