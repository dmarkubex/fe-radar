import { describe, expect, it } from "vitest";
import { getBreadcrumb, getDataNav } from "../nav";

describe("AppShell 灰度导航", () => {
  it("copilotEnabled=false 时数据区不含「问答」（回代验算）", () => {
    const nav = getDataNav(false);
    expect(nav.some((item) => item.href === "/ask")).toBe(false);
  });

  it("copilotEnabled=true 时数据区含「问答」，与「条目查询」并列", () => {
    const nav = getDataNav(true);
    const ask = nav.find((item) => item.href === "/ask");
    expect(ask).toBeDefined();
    expect(ask?.label).toBe("问答");
    expect(ask?.minRole).toBe("viewer");
    expect(nav.findIndex((item) => item.href === "/items")).toBeLessThan(
      nav.findIndex((item) => item.href === "/ask")
    );
  });

  it("copilotEnabled=false 时数据区保持原样", () => {
    expect(getDataNav(false).map((item) => item.href)).toEqual([
      "/items",
      "/search",
      "/admin/entities"
    ]);
  });
});

describe("getBreadcrumb", () => {
  it("/ask → 数据 / 问答", () => {
    expect(getBreadcrumb("/ask")).toBe("数据 / 问答");
  });

  it("既有路径不受影响", () => {
    expect(getBreadcrumb("/")).toBe("监测 / 时间线");
    expect(getBreadcrumb("/items")).toBe("数据 / 详情");
  });
});
