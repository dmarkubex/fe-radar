import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// vitest 跑在 node 环境（无 jsdom），改为源码级断言，与 /ask 页测试同款。
const read = (path: string): string => readFileSync(resolve(__dirname, path), "utf8");

const filterBar = read("../filter-bar.tsx");
const pageHeader = read("../../layout/page-header.tsx");

describe("移动端筛选条折叠", () => {
  it("shell 以下默认折叠：开关可见、chip 区 hidden", () => {
    expect(filterBar).toContain("useState(false)");
    expect(filterBar).toContain("shell:hidden");
    expect(filterBar).toContain('${open ? "flex" : "hidden"}');
  });

  it("shell 以上常驻展开（开关隐藏、chip 区 shell:flex）", () => {
    expect(filterBar).toContain("shell:flex");
  });

  it("开关显示已选筛选数，折叠时不丢失当前筛选可见性", () => {
    expect(filterBar).toContain('FILTER_KEYS.filter((key) => params.get(key)).length');
    expect(filterBar).toContain("已选");
  });

  it("开关有 aria-expanded", () => {
    expect(filterBar).toContain("aria-expanded={open}");
  });
});

describe("PageHeader 移动端密度", () => {
  it("description 在 shell 以下隐藏", () => {
    expect(pageHeader).toContain('hidden text-sm leading-relaxed text-fg-muted shell:block');
  });
});
