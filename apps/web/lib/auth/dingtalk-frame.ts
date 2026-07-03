export interface DingtalkFrameLoginParams {
  redirect_uri: string;
  client_id: string;
  scope: string;
  response_type: string;
  corpId?: string;
  prompt?: string;
  state?: string;
}

export function getDingtalkFrameLoginParams(rawUrl: string): DingtalkFrameLoginParams {
  const url = new URL(rawUrl);
  const redirectUri = requiredParam(url, "redirect_uri");
  const clientId = requiredParam(url, "client_id");
  const scope = requiredParam(url, "scope");
  const corpId = optionalEncodedParam(url, "corpId");
  if (scope.split(/\s+/).includes("corpid") && !corpId) {
    throw new Error("DingTalk auth URL missing corpId for corpid scope");
  }

  return {
    redirect_uri: encodeURIComponent(redirectUri),
    client_id: clientId,
    scope: encodeURIComponent(scope),
    response_type: url.searchParams.get("response_type") ?? "code",
    corpId,
    prompt: url.searchParams.get("prompt") || undefined,
    state: optionalEncodedParam(url, "state")
  };
}

function requiredParam(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  if (!value) {
    throw new Error(`DingTalk auth URL missing ${key}`);
  }
  return value;
}

function optionalEncodedParam(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  return value ? encodeURIComponent(value) : undefined;
}
