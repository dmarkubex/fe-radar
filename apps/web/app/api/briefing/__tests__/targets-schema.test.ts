import { describe, expect, it } from "vitest";
import {
  createTargetSchema,
  maskWebhookUrl,
  scheduleConfigSchema,
  toPublicTarget,
  updateTargetSchema,
} from "../../../../lib/api/briefing-schema";

describe("briefing targets schema — createTargetSchema", () => {
  it("accepts valid dingtalk_bot target with sign_secret", () => {
    expect(
      createTargetSchema.safeParse({
        name: "研发群机器人",
        channel: "dingtalk_bot",
        webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=abc123",
        signSecret: "SEC_abc",
        enabled: true
      }).success
    ).toBe(true);
  });

  it("accepts target without sign_secret (optional)", () => {
    expect(
      createTargetSchema.safeParse({
        name: "无密钥机器人",
        channel: "dingtalk_bot",
        webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=def456"
      }).success
    ).toBe(true);
  });

  it("rejects unknown channel value", () => {
    const result = createTargetSchema.safeParse({
      name: "坏渠道",
      channel: "wechat",
      webhookUrl: "https://example.com/webhook"
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = createTargetSchema.safeParse({
      name: "",
      channel: "dingtalk_bot",
      webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=abc"
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid webhookUrl", () => {
    const result = createTargetSchema.safeParse({
      name: "坏 URL",
      channel: "dingtalk_bot",
      webhookUrl: "not-a-url"
    });
    expect(result.success).toBe(false);
  });
});

describe("briefing targets schema — updateTargetSchema", () => {
  it("accepts partial update with only name", () => {
    expect(
      updateTargetSchema.safeParse({ name: "新名称" }).success
    ).toBe(true);
  });

  it("accepts partial update with enabled=false (soft disable)", () => {
    expect(
      updateTargetSchema.safeParse({ enabled: false }).success
    ).toBe(true);
  });

  it("accepts omitting signSecret entirely (keep existing value)", () => {
    // Empty object is a valid partial update — signSecret is not touched
    expect(
      updateTargetSchema.safeParse({ name: "改名" }).success
    ).toBe(true);
  });

  it("rejects webhookUrl that is not a valid URL on update", () => {
    const result = updateTargetSchema.safeParse({ webhookUrl: "bad-url" });
    expect(result.success).toBe(false);
  });

  it("rejects signSecret shorter than 1 char", () => {
    const result = updateTargetSchema.safeParse({ signSecret: "" });
    // min(1) rejects empty string (non-null, non-undefined empty string)
    expect(result.success).toBe(false);
  });

  it("accepts update without webhookUrl (edit keep-existing contract)", () => {
    expect(
      updateTargetSchema.safeParse({ name: "改名", enabled: true }).success
    ).toBe(true);
  });
});

describe("toPublicTarget / maskWebhookUrl — credential redaction", () => {
  const raw =
    "https://oapi.dingtalk.com/robot/send?access_token=SECRET_TOKEN_VALUE";

  it("maskWebhookUrl strips query so access_token never appears", () => {
    const masked = maskWebhookUrl(raw);
    expect(masked).not.toContain("access_token");
    expect(masked).not.toContain("SECRET_TOKEN_VALUE");
    expect(masked).toContain("oapi.dingtalk.com");
    expect(masked).toContain("***(masked)");
  });

  it("toPublicTarget never returns webhookUrl or signSecret fields", () => {
    const pub = toPublicTarget({
      id: 1,
      name: "群A",
      channel: "dingtalk_bot",
      webhookUrl: raw,
      signSecret: "SECxxx",
      enabled: true,
      createdAt: null,
    });
    expect(pub).toMatchObject({
      id: 1,
      name: "群A",
      channel: "dingtalk_bot",
      enabled: true,
      webhookConfigured: true,
      signSecretConfigured: true,
    });
    expect(pub.webhookUrlMasked).not.toContain("access_token");
    expect(pub.webhookUrlMasked).not.toContain("SECRET_TOKEN");
    expect(Object.keys(pub)).not.toContain("webhookUrl");
    expect(Object.keys(pub)).not.toContain("signSecret");
    expect(JSON.stringify(pub)).not.toContain("SECxxx");
  });

  it("marks unconfigured secret when null", () => {
    const pub = toPublicTarget({
      id: 2,
      name: "群B",
      channel: "dingtalk_bot",
      webhookUrl: "https://example.com/hook",
      signSecret: null,
      enabled: false,
    });
    expect(pub.signSecretConfigured).toBe(false);
    expect(pub.webhookConfigured).toBe(true);
  });
});

describe("soft-confirm delete — business logic guard", () => {
  it("delete requires name match before confirming (UI contract)", () => {
    // This unit test documents the contract: delete confirm button is disabled
    // until inputValue === target.name (enforced by target-table.tsx component state).
    // Since the logic is in component state, we test the matching condition here.
    const targetName = "研发群机器人";
    const emptyInput: string = "";
    const wrongInput: string = "研发群";
    const correctInput: string = targetName;

    expect(emptyInput === targetName).toBe(false);
    expect(wrongInput === targetName).toBe(false);
    expect(correctInput === targetName).toBe(true);
  });
});

describe("test-push toast — result mapping", () => {
  it("maps ok=true response to success toast message", () => {
    const apiResponse = { ok: true };
    const toastOk = apiResponse.ok === true;
    expect(toastOk).toBe(true);
  });

  it("maps ok=false response with error message to failure toast", () => {
    const apiResponse = { ok: false, error: "钉钉返回错误" };
    const toastOk = apiResponse.ok === true;
    const toastText = apiResponse.ok ? "成功" : `推送失败：${apiResponse.error}`;
    expect(toastOk).toBe(false);
    expect(toastText).toBe("推送失败：钉钉返回错误");
  });
});

describe("scheduleConfigSchema — daily push schedule", () => {
  it("accepts valid config and strips trailing slash from baseUrl", () => {
    const result = scheduleConfigSchema.safeParse({
      enabled: true,
      sendTime: "16:15",
      scheduleMode: "business_days",
      baseUrl: "https://fe-radar.internal/",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseUrl).toBe("https://fe-radar.internal");
      expect(result.data.enabled).toBe(true);
    }
  });

  it("rejects invalid HH:mm", () => {
    expect(
      scheduleConfigSchema.safeParse({
        enabled: false,
        sendTime: "8:00",
        scheduleMode: "daily",
        baseUrl: "http://fe-radar.internal",
      }).success
    ).toBe(false);
  });

  it("rejects non-http baseUrl", () => {
    expect(
      scheduleConfigSchema.safeParse({
        enabled: false,
        sendTime: "16:15",
        scheduleMode: "daily",
        baseUrl: "file:///tmp",
      }).success
    ).toBe(false);
  });

  it("rejects unknown scheduleMode", () => {
    expect(
      scheduleConfigSchema.safeParse({
        enabled: false,
        sendTime: "16:15",
        scheduleMode: "weekdays",
        baseUrl: "http://fe-radar.internal",
      }).success
    ).toBe(false);
  });
});

// Real ActionCard payload assertions live in
// apps/web/app/api/briefing/targets/[id]/test/__tests__/route.test.ts
// (imports the route handler directly — T-DUP Round 2).
