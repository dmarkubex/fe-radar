import { describe, expect, it } from "vitest";
import { APP_TIMEZONE, nowInAppTimezone } from "../index";

describe("dayjs timezone", () => {
  it("uses Asia/Shanghai as the application timezone", () => {
    expect(nowInAppTimezone().format("Z")).toBe("+08:00");
    expect(APP_TIMEZONE).toBe("Asia/Shanghai");
  });
});
