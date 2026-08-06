import { describe, expect, it, vi } from "vitest";
import { requestAuthCode } from "../dingtalk-jsapi";

describe("requestAuthCode", () => {
  it("waits for dd.ready and resolves a trimmed one-time code", async () => {
    const request = vi.fn((options: { onSuccess?: (result: { code?: string }) => void }) => {
      options.onSuccess?.({ code: " auth-code " });
    });
    const ready = vi.fn((run: () => void) => run());

    await expect(
      requestAuthCode({ runtime: { permission: { requestAuthCode: request } }, ready }, "corp-1")
    ).resolves.toBe("auth-code");
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ corpId: "corp-1" }));
  });

  it("rejects when the JSAPI reports failure", async () => {
    const request = vi.fn((options: { onFail?: (error: unknown) => void }) => {
      options.onFail?.({ errorCode: "1" });
    });

    await expect(
      requestAuthCode({ runtime: { permission: { requestAuthCode: request } } }, "corp-1")
    ).rejects.toThrow("requestAuthCode failed");
  });
});
