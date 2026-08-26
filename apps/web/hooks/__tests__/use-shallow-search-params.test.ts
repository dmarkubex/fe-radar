import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hookSource = readFileSync(
  resolve(__dirname, "../use-shallow-search-params.ts"),
  "utf8"
);
const filterBar = readFileSync(
  resolve(__dirname, "../../components/timeline/filter-bar.tsx"),
  "utf8"
);
const searchBox = readFileSync(
  resolve(__dirname, "../../components/search/search-box.tsx"),
  "utf8"
);

describe("T-PERF-04 shallow search params", () => {
  it("uses history.replaceState and does not call router.replace", () => {
    expect(hookSource).toContain("window.history.replaceState");
    expect(hookSource).toContain("fe-radar:shallow-search");
    expect(hookSource).toContain("popstate");
    expect(filterBar).toContain("replaceShallowSearch");
    expect(filterBar).not.toContain("router.replace");
    expect(searchBox).toContain("replaceShallowSearch");
    expect(searchBox).not.toContain("router.replace");
  });

  it("hydrates from useSearchParams so the first paint matches SSR", () => {
    expect(hookSource).toContain("useSearchParams");
    expect(hookSource).toContain("useSyncExternalStore");
    expect(hookSource).toContain("serverParams.toString()");
  });
});
