import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hookSource = readFileSync(resolve(__dirname, "../use-timeline.ts"), "utf8");
const timelineListSource = readFileSync(
  resolve(__dirname, "../../components/timeline/timeline-list.tsx"),
  "utf8"
);
const layoutSource = readFileSync(resolve(__dirname, "../../app/layout.tsx"), "utf8");
const queryProviderSource = readFileSync(
  resolve(__dirname, "../../components/providers/query-provider.tsx"),
  "utf8"
);

describe("T-PERF-02 QueryClient staleTime", () => {
  it("useTimeline sets staleTime and disables remount/focus refetch", () => {
    expect(hookSource).toContain("staleTime: 30_000");
    expect(hookSource).toContain("refetchOnMount: false");
    expect(hookSource).toContain("refetchOnWindowFocus: false");
    expect(hookSource).toContain("placeholderData");
    expect(hookSource).toContain("ssrEndpointRef");
    expect(hookSource).toContain("enabled: canFetchTimeline(endpoint)");
  });

  it("TimelineList does not create its own QueryClient", () => {
    expect(timelineListSource).not.toContain("new QueryClient");
    expect(timelineListSource).not.toContain("QueryClientProvider");
  });

  it("login layout branch does not wrap with QueryProvider", () => {
    const loginReturn = layoutSource.match(
      /if \(isLoginPage\) \{\s*return \(([\s\S]*?)\);\s*\}/
    );
    expect(loginReturn).not.toBeNull();
    expect(loginReturn![1]).toContain("<body>{children}</body>");
    expect(loginReturn![1]).not.toContain("QueryProvider");
  });

  it("non-login layout branch wraps AppShell with QueryProvider", () => {
    expect(layoutSource).toContain("<QueryProvider>");
    expect(layoutSource).toContain("</QueryProvider>");
  });

  it("QueryProvider uses useState QueryClient with 30s staleTime", () => {
    expect(queryProviderSource).toContain("staleTime: 30_000");
    expect(queryProviderSource).toContain("useState");
    expect(queryProviderSource).not.toMatch(/useMemo\s*\(\s*\(\)\s*=>\s*new QueryClient/);
  });
});

const timelineCardSource = readFileSync(
  resolve(__dirname, "../../components/timeline/timeline-card.tsx"),
  "utf8"
);
const timelineListSourceForMemo = readFileSync(
  resolve(__dirname, "../../components/timeline/timeline-list.tsx"),
  "utf8"
);

describe("T-PERF-05 list render", () => {
  it("memoizes TimelineCard and groups items with useMemo", () => {
    expect(timelineCardSource).toContain("export const TimelineCard = memo(");
    expect(timelineCardSource).toContain("timeline-card");
    expect(timelineListSourceForMemo).toContain("useMemo(() => groupTimeline(items), [items])");
  });
});
