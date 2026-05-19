import { describe, expect, it, vi, beforeEach } from "vitest";

type SqlTag = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>) & {
  end: (opts?: { timeout?: number }) => Promise<void>;
};

let mockHasVector = true;
let mockSelect1Throws: Error | null = null;

const calls: string[] = [];

const fakeSql: SqlTag = Object.assign(
  (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const q = strings.join("?").trim();
    calls.push(q);
    if (mockSelect1Throws && q === "SELECT 1") {
      return Promise.reject(mockSelect1Throws);
    }
    if (q.includes("pg_extension")) {
      return Promise.resolve(mockHasVector ? [{ "?column?": 1 }] : []);
    }
    return Promise.resolve([{ "?column?": 1 }]);
  },
  { end: vi.fn(() => Promise.resolve()) }
);

vi.mock("../client", () => ({
  createSqlClient: vi.fn(() => fakeSql)
}));

const { health } = await import("../health");

describe("db health probe", () => {
  beforeEach(() => {
    mockHasVector = true;
    mockSelect1Throws = null;
    calls.length = 0;
    (fakeSql.end as ReturnType<typeof vi.fn>).mockClear();
  });

  it("returns ok=true when pgvector extension is installed", async () => {
    mockHasVector = true;
    const result = await health({ runtime: "web" });
    expect(result.ok).toBe(true);
    expect(typeof result.latencyMs).toBe("number");
    expect(calls.some((q) => q.includes("pg_extension"))).toBe(true);
  });

  it("returns ok=false with clear error when pgvector is missing", async () => {
    mockHasVector = false;
    const result = await health({ runtime: "web" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/pgvector/i);
  });

  it("returns ok=false when connectivity probe SELECT 1 fails", async () => {
    mockSelect1Throws = new Error("connection refused");
    const result = await health({ runtime: "web" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/connection refused/);
  });

  it("always closes the sql client (finally block)", async () => {
    await health({ runtime: "web" });
    expect(fakeSql.end).toHaveBeenCalledTimes(1);
  });
});
