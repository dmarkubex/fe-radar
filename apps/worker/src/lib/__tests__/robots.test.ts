import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceFetchError } from "@fe-radar/shared";
import { assertRobotsAllowed, clearRobotsCache } from "../robots";

describe("robots guard", () => {
  afterEach(() => {
    clearRobotsCache();
    vi.unstubAllEnvs();
  });

  it("blocks disallowed private path", async () => {
    const fetchImpl = async () => new Response("User-agent: *\nDisallow: /private\n");
    await expect(
      assertRobotsAllowed("https://example.com/private/data", "FE-Radar Bot", fetchImpl as typeof fetch)
    ).rejects.toThrow("disallows");
  });

  it("allows public path", async () => {
    const fetchImpl = async () => new Response("User-agent: *\nDisallow: /private\n");
    await expect(
      assertRobotsAllowed("https://example.com/news", "FE-Radar Bot", fetchImpl as typeof fetch)
    ).resolves.toBeUndefined();
  });

  it("allows fetch when robots.txt cannot be fetched (fail-open)", async () => {
    const fetchImpl = async () => new Response("not found", { status: 404 });
    await expect(
      assertRobotsAllowed("https://example.com/news", "FE-Radar Bot", fetchImpl as typeof fetch)
    ).resolves.toBeUndefined();
  });

  // S5 / C1: 首跳 302 → metadata；第二跳不得发出（redirect: manual + 守卫拒 Location）
  it("does not follow robots.txt redirect to metadata / private IP (no second hop)", async () => {
    vi.stubEnv("SSRF_GUARD_ENABLED", "true");
    const fetchedUrls: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      fetchedUrls.push(url);
      if (url.includes("/robots.txt") && !url.includes("169.254")) {
        return new Response(null, {
          status: 302,
          headers: { Location: "http://169.254.169.254/latest/meta-data" }
        });
      }
      // 若第二跳被错误发出，返回 200 会污染测试；显式失败信息。
      return new Response("SHOULD_NOT_BE_FETCHED", { status: 200 });
    };

    await expect(
      assertRobotsAllowed("https://93.184.216.34/news", "FE-Radar Bot", fetchImpl as typeof fetch)
    ).rejects.toMatchObject({
      name: "SourceFetchError",
      code: "FETCH_SSRF_BLOCKED"
    });

    expect(fetchedUrls).toHaveLength(1);
    expect(fetchedUrls[0]).toBe("https://93.184.216.34/robots.txt");
    expect(fetchedUrls.some((u) => u.includes("169.254"))).toBe(false);
  });

  it("SSRF block on robots path does not fail-open into crawl (stricter)", async () => {
    vi.stubEnv("SSRF_GUARD_ENABLED", "true");
    const fetchImpl = async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/robots.txt" }
      });

    await expect(
      assertRobotsAllowed("https://93.184.216.34/page", "FE-Radar Bot", fetchImpl as typeof fetch)
    ).rejects.toBeInstanceOf(SourceFetchError);
  });

  it("still fail-opens on network error (unchanged compliance path)", async () => {
    vi.stubEnv("SSRF_GUARD_ENABLED", "false");
    const fetchImpl = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(
      assertRobotsAllowed("https://example.com/news", "FE-Radar Bot", fetchImpl as typeof fetch)
    ).resolves.toBeUndefined();
  });
});

/**
 * S5 缺陷 A：防 stack.yml ↔ compose.portainer-current.yml 再漂移。
 * 放在 apps/worker/src/lib/__tests__（允许清单内 robots 测试文件同目录、同 vitest 包），
 * 因为 worker 是 FETCH_INTERNAL_ALLOWLIST 的消费方。
 */
describe("deploy FETCH_INTERNAL_ALLOWLIST mirror (S5)", () => {
  function extractWorkerAllowlist(ymlPath: string): string | null {
    const content = readFileSync(ymlPath, "utf8");
    // 取 services.worker 块：从「  worker:」到下一个同级 key 或文件尾
    const workerBlock = content.match(/^[ \t]{2}worker:\n([\s\S]*?)(?=^[ \t]{2}[a-zA-Z_]|(?!.|\n))/m);
    const blockBody = workerBlock?.[1];
    if (!blockBody) return null;
    const m = blockBody.match(/^\s*FETCH_INTERNAL_ALLOWLIST:\s*(.+)\s*$/m);
    const raw = m?.[1];
    if (!raw) return null;
    return raw.trim().replace(/^["']|["']$/g, "");
  }

  it("stack.yml and compose.portainer-current.yml worker allowlist match", () => {
    const root = resolve(__dirname, "../../../../../");
    const stackVal = extractWorkerAllowlist(resolve(root, "deploy/stack.yml"));
    const currentVal = extractWorkerAllowlist(
      resolve(root, "deploy/compose.portainer-current.yml")
    );
    expect(stackVal).toBe("rsshub");
    expect(currentVal).toBe("rsshub");
    expect(currentVal).toBe(stackVal);
  });
});
