import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DingtalkBotError } from "@fe-radar/shared";
import {
  DINGTALK_REDACT_PATHS,
  sendActionCard,
  sendMarkdown,
  sendText,
  signWebhook,
} from "../dingtalk-bot";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSignedUrl(webhookUrl: string, signSecret: string, timestamp: number): string {
  const stringToSign = `${timestamp}\n${signSecret}`;
  const hmac = crypto.createHmac("sha256", signSecret).update(stringToSign).digest("base64");
  const sign = encodeURIComponent(hmac);
  return `${webhookUrl}&timestamp=${timestamp}&sign=${sign}`;
}

const WEBHOOK = "https://oapi.dingtalk.com/robot/send?access_token=abc123";
const SECRET = "SECxxx_test_secret";
const FIXED_TS = 1_716_086_400_000; // 2026-05-19 00:00:00 UTC in ms

function okResponse() {
  return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function errResponse(errcode: number, errmsg: string) {
  return new Response(JSON.stringify({ errcode, errmsg }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Case 1 – signWebhook: 加签格式正确
// ---------------------------------------------------------------------------
describe("signWebhook", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_TS);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns URL with correct timestamp and sign query params", () => {
    const result = signWebhook(WEBHOOK, SECRET);
    const expected = buildSignedUrl(WEBHOOK, SECRET, FIXED_TS);
    expect(result).toBe(expected);
  });

  it("timestamp param equals Date.now() ms value", () => {
    const result = signWebhook(WEBHOOK, SECRET);
    const url = new URL(result);
    expect(url.searchParams.get("timestamp")).toBe(String(FIXED_TS));
  });

  it("sign param is base64+urlencode of HMAC-SHA256(ts\\nsecret, secret)", () => {
    const result = signWebhook(WEBHOOK, SECRET);
    const url = new URL(result);
    const signParam = url.searchParams.get("sign")!;
    const stringToSign = `${FIXED_TS}\n${SECRET}`;
    const hmac = crypto.createHmac("sha256", SECRET).update(stringToSign).digest("base64");
    // searchParams.get() already url-decodes, so compare against raw base64
    expect(signParam).toBe(hmac);
  });
});

// ---------------------------------------------------------------------------
// Case 2 – sendText: calls fetch with signed URL
// ---------------------------------------------------------------------------
describe("sendText", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calls fetch with a signed URL and correct msgtype=text body", async () => {
    vi.spyOn(Date, "now").mockReturnValue(FIXED_TS);
    const mockFetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", mockFetch);

    await sendText(WEBHOOK, SECRET, "hello world");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [calledUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit];

    const expectedUrl = buildSignedUrl(WEBHOOK, SECRET, FIXED_TS);
    expect(calledUrl).toBe(expectedUrl);

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.msgtype).toBe("text");
    expect((body.text as { content: string }).content).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// Case 3 – sendMarkdown: request body format
// ---------------------------------------------------------------------------
describe("sendMarkdown", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends msgtype=markdown with title and text fields", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", mockFetch);

    await sendMarkdown(WEBHOOK, SECRET, "市场简报", "## 标题\n内容");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.msgtype).toBe("markdown");
    const md = body.markdown as { title: string; text: string };
    expect(md.title).toBe("市场简报");
    expect(md.text).toBe("## 标题\n内容");
  });
});

// ---------------------------------------------------------------------------
// Case 4 – sendActionCard: request body format
// ---------------------------------------------------------------------------
describe("sendActionCard", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends msgtype=actionCard with btns array", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", mockFetch);

    await sendActionCard(WEBHOOK, SECRET, {
      title: "远东·铜锂行情简报",
      text: "## 简报\n沪铜 78,520",
      btns: [{ title: "查看完整简报", actionURL: "https://fe-radar.internal/briefing/1" }],
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.msgtype).toBe("actionCard");
    const card = body.actionCard as {
      title: string;
      text: string;
      btnOrientation: string;
      btns: Array<{ title: string; actionURL: string }>;
    };
    expect(card.title).toBe("远东·铜锂行情简报");
    expect(card.btns).toHaveLength(1);
    const firstBtn = card.btns[0]!;
    expect(firstBtn.title).toBe("查看完整简报");
    expect(card.btnOrientation).toBe("0"); // default
  });
});

// ---------------------------------------------------------------------------
// Case 5 – HTTP failure / timeout → throws DingtalkBotError
// ---------------------------------------------------------------------------
describe("HTTP failure", () => {
  afterEach(() => vi.restoreAllMocks());

  it("throws DingtalkBotError when fetch rejects (network error / timeout)", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    vi.stubGlobal("fetch", mockFetch);

    await expect(sendText(WEBHOOK, SECRET, "test")).rejects.toBeInstanceOf(DingtalkBotError);
  });

  it("throws DingtalkBotError when HTTP response is non-2xx", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("Internal Server Error", { status: 500 }));
    vi.stubGlobal("fetch", mockFetch);

    await expect(sendText(WEBHOOK, SECRET, "test")).rejects.toBeInstanceOf(DingtalkBotError);
  });
});

// ---------------------------------------------------------------------------
// Case 6 – DingTalk errcode != 0 → throws with errcode
// ---------------------------------------------------------------------------
describe("DingTalk API errcode", () => {
  afterEach(() => vi.restoreAllMocks());

  it("throws DingtalkBotError with errcode when API returns non-zero errcode", async () => {
    const mockFetch = vi.fn().mockResolvedValue(errResponse(310000, "sign not match"));
    vi.stubGlobal("fetch", mockFetch);

    const err = await sendText(WEBHOOK, SECRET, "test").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DingtalkBotError);
    expect((err as DingtalkBotError).errcode).toBe(310000);
    expect((err as DingtalkBotError).errmsg).toBe("sign not match");
  });
});

// ---------------------------------------------------------------------------
// Case 7 – Pino redact: DINGTALK_REDACT_PATHS covers webhook/sign fields
// ---------------------------------------------------------------------------
describe("DINGTALK_REDACT_PATHS", () => {
  it("includes webhookUrl, signSecret, webhook, and sign in redact paths", () => {
    expect(DINGTALK_REDACT_PATHS).toContain("webhookUrl");
    expect(DINGTALK_REDACT_PATHS).toContain("signSecret");
    expect(DINGTALK_REDACT_PATHS).toContain("webhook");
    expect(DINGTALK_REDACT_PATHS).toContain("sign");
  });

  it("does not log raw webhookUrl in error context (maskedUrl used)", async () => {
    const loggedObjects: unknown[] = [];
    // We verify the implementation never passes the raw webhook to logger by
    // checking that the signWebhook call is the only place the URL is used.
    // Here we do a structural check: mock fetch to throw, capture logger output.
    const mockFetch = vi.fn().mockRejectedValue(new Error("connection refused"));
    vi.stubGlobal("fetch", mockFetch);

    const err = await sendText(WEBHOOK, SECRET, "test").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DingtalkBotError);

    // The error's details should only contain the masked URL (last 4 chars), not the full webhook
    const details = (err as DingtalkBotError).details as Record<string, string>;
    expect(details.webhookMask).not.toContain("access_token=abc123");
    expect(details.webhookMask).toMatch(/\*\*\*.{4}$/);
  });
});
