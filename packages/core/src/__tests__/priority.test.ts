import { describe, expect, it } from "vitest";
import {
  DEFAULT_OWN_COMPANY_PROFILE,
  detectPriorityFromText,
  isOwnCompanyEntity,
  isOwnCompanyName,
  ownCompanyProfileFromNames,
} from "../priority";

describe("isOwnCompanyName / isOwnCompanyEntity", () => {
  it("matches Far East synonym group", () => {
    expect(isOwnCompanyName("远东控股")).toBe(true);
    expect(isOwnCompanyName("远东电缆")).toBe(true);
    expect(isOwnCompanyName("远东智慧能源")).toBe(true);
    expect(isOwnCompanyName("远东股份")).toBe(true);
    expect(isOwnCompanyEntity({ canonicalName: "远东控股" })).toBe(true);
  });

  it("does not treat other C1 entities as own company", () => {
    expect(isOwnCompanyName("国家电网")).toBe(false);
    expect(isOwnCompanyName("国家发改委")).toBe(false);
    expect(isOwnCompanyName("南方电网")).toBe(false);
    expect(isOwnCompanyEntity({ canonicalName: "国家电网" })).toBe(false);
  });

  // T4 (Finding #4): 删除「远东」2 字子串兜底后，「上海远东仪表厂」「远东发展」等
  // 含「远东」子串的实体不再被误判为本公司（DEFAULT profile 现仅含 ≥3 字精确名）。
  it("does NOT misclassify '远东'-substring entities as own (T4: removed 2-char fallback)", () => {
    expect(isOwnCompanyName("上海远东仪表厂")).toBe(false);
    expect(isOwnCompanyName("大连远东工具")).toBe(false);
    expect(isOwnCompanyName("远东发展")).toBe(false);
    expect(isOwnCompanyName("远东")).toBe(false); // 2 字短词不再单独成立
  });

  // T4: 注入式 profile——admin 在 DB entities 新增的远东别名（如"远东通讯"）经 worker
  // 构造 profile 注入后即可精确等值命中，无需改 core 代码。
  it("matches injected custom profile aliases (exact equality)", () => {
    const profile = ownCompanyProfileFromNames(["远东控股", "远东通讯", "远东"]);
    expect(isOwnCompanyName("远东通讯", profile)).toBe(true);
    expect(isOwnCompanyName("远东", profile)).toBe(false); // <3 字被 ownCompanyProfileFromNames 过滤掉
    expect(isOwnCompanyName("上海远东仪表厂", profile)).toBe(false); // 子串不算
    expect(isOwnCompanyEntity({ canonicalName: "远东通讯" }, profile)).toBe(true);
  });
});

describe("detectPriorityFromText", () => {
  it("flags Far East mentions as priority", () => {
    expect(detectPriorityFromText("远东电缆中标国网江苏", "")).toBe(true);
  });

  it("flags accident keywords as priority", () => {
    expect(detectPriorityFromText("某厂区发生火灾", "无伤亡")).toBe(true);
    expect(detectPriorityFromText("爆炸事故调查", "")).toBe(true);
    expect(detectPriorityFromText("厂房发生坍塌", "")).toBe(true);
    expect(detectPriorityFromText("事故造成人员伤亡", "")).toBe(true);
  });

  it("flags policy number patterns as priority", () => {
    expect(detectPriorityFromText("发布 GB/T 12706 修订稿", "")).toBe(true);
    expect(detectPriorityFromText("发改能源〔2024〕12号印发", "")).toBe(true);
  });

  it("returns false for ordinary industry news", () => {
    expect(detectPriorityFromText("铜价小幅上涨", "现货成交清淡")).toBe(false);
  });

  // T4 (Finding #4): DEFAULT profile 不再含「远东」2 字，故「上海远东仪表厂中标」这类
  // 仅含子串的标题不再被误判为 priority（除非出现完整精确名如「远东电缆」）。
  it("does NOT flag '远东'-substring-only text as priority (T4)", () => {
    expect(detectPriorityFromText("上海远东仪表厂中标", "")).toBe(false);
    expect(detectPriorityFromText("远东发展集团动态", "")).toBe(false);
  });

  it("DEFAULT_OWN_COMPANY_PROFILE excludes 2-char '远东'", () => {
    expect(DEFAULT_OWN_COMPANY_PROFILE.names.has("远东")).toBe(false);
    expect(DEFAULT_OWN_COMPANY_PROFILE.names.has("远东控股")).toBe(true);
  });
});
