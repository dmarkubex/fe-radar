import crypto from "node:crypto";
import { createLogger, DingtalkBotError } from "@fe-radar/shared";

const logger = createLogger({
  service: "dingtalk-bot",
  // redact webhook/sign fields in addition to global REDACT_PATHS
});

/** Pino redact paths for this module's log calls */
const MODULE_REDACT = ["webhookUrl", "signSecret", "webhook", "sign"] as const;

function maskedUrl(url: string): string {
  // Show only last 4 chars of the URL to aid debugging without leaking token
  return `***${url.slice(-4)}`;
}

/**
 * Build signed webhook URL per design §10.2.
 * timestamp = Date.now() (ms)
 * string_to_sign = `${timestamp}\n${signSecret}`
 * hmac = HmacSHA256(string_to_sign, signSecret) → base64 → urlencode
 * final_url = `${webhookUrl}&timestamp=${timestamp}&sign=${sign}`
 */
export function signWebhook(webhookUrl: string, signSecret: string): string {
  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${signSecret}`;
  const hmac = crypto
    .createHmac("sha256", signSecret)
    .update(stringToSign)
    .digest("base64");
  const sign = encodeURIComponent(hmac);
  return `${webhookUrl}&timestamp=${timestamp}&sign=${sign}`;
}

interface ActionCardBtn {
  title: string;
  actionURL: string;
}

interface ActionCardOptions {
  title: string;
  text: string;
  btnOrientation?: "0" | "1";
  btns: ActionCardBtn[];
}

async function postToWebhook(
  webhookUrl: string,
  signSecret: string,
  body: Record<string, unknown>
): Promise<void> {
  const signedUrl = signWebhook(webhookUrl, signSecret);

  let response: Response;
  try {
    response = await fetch(signedUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.error(
      { err, webhookMask: maskedUrl(webhookUrl) },
      "dingtalk-bot: HTTP request failed"
    );
    throw new DingtalkBotError(
      "DINGTALK_HTTP_ERROR",
      `DingTalk webhook request failed: ${err instanceof Error ? err.message : String(err)}`,
      { webhookMask: maskedUrl(webhookUrl) }
    );
  }

  if (!response.ok) {
    logger.error(
      { status: response.status, webhookMask: maskedUrl(webhookUrl) },
      "dingtalk-bot: HTTP non-2xx response"
    );
    throw new DingtalkBotError(
      "DINGTALK_HTTP_ERROR",
      `DingTalk webhook HTTP ${response.status}`,
      { status: response.status, webhookMask: maskedUrl(webhookUrl) }
    );
  }

  let json: { errcode: number; errmsg: string };
  try {
    json = (await response.json()) as { errcode: number; errmsg: string };
  } catch (err) {
    throw new DingtalkBotError(
      "DINGTALK_PARSE_ERROR",
      "Failed to parse DingTalk response JSON",
      { webhookMask: maskedUrl(webhookUrl) }
    );
  }

  if (json.errcode !== 0) {
    logger.error(
      { errcode: json.errcode, errmsg: json.errmsg, webhookMask: maskedUrl(webhookUrl) },
      "dingtalk-bot: API returned non-zero errcode"
    );
    throw new DingtalkBotError(
      "DINGTALK_API_ERROR",
      `DingTalk API error ${json.errcode}: ${json.errmsg}`,
      { errcode: json.errcode, errmsg: json.errmsg, webhookMask: maskedUrl(webhookUrl) },
      json.errcode,
      json.errmsg
    );
  }
}

/**
 * Send a text message to a DingTalk group bot.
 * @param webhookUrl  Full webhook URL (without timestamp/sign)
 * @param signSecret  Signing secret for HMAC-SHA256
 * @param content     Text body
 * @param atMobiles   Optional list of mobile numbers to @mention
 */
export async function sendText(
  webhookUrl: string,
  signSecret: string,
  content: string,
  atMobiles?: string[]
): Promise<void> {
  const body: Record<string, unknown> = {
    msgtype: "text",
    text: { content },
    at: { atMobiles: atMobiles ?? [], isAtAll: false },
  };
  await postToWebhook(webhookUrl, signSecret, body);
}

/**
 * Send a markdown message to a DingTalk group bot.
 */
export async function sendMarkdown(
  webhookUrl: string,
  signSecret: string,
  title: string,
  content: string
): Promise<void> {
  const body: Record<string, unknown> = {
    msgtype: "markdown",
    markdown: { title, text: content },
  };
  await postToWebhook(webhookUrl, signSecret, body);
}

/**
 * Send an actionCard message to a DingTalk group bot (design §10.3).
 */
export async function sendActionCard(
  webhookUrl: string,
  signSecret: string,
  options: ActionCardOptions
): Promise<void> {
  const body: Record<string, unknown> = {
    msgtype: "actionCard",
    actionCard: {
      title: options.title,
      text: options.text,
      btnOrientation: options.btnOrientation ?? "0",
      btns: options.btns.map((b) => ({ title: b.title, actionURL: b.actionURL })),
    },
  };
  await postToWebhook(webhookUrl, signSecret, body);
}

// Re-export MODULE_REDACT so callers can merge into their Pino config
export { MODULE_REDACT as DINGTALK_REDACT_PATHS };
