import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProxyExhaustedError, ProxyPool, loadProxyList } from "../proxy-pool";

describe("proxy pool", () => {
  it("loads proxies from file and disables failed proxy after threshold", () => {
    const dir = mkdtempSync(join(tmpdir(), "fe-proxy-"));
    const file = join(dir, "proxy.txt");
    writeFileSync(file, "127.0.0.1:8080\n# comment\nhttps://proxy.example:443\n");

    expect(loadProxyList(file)).toHaveLength(2);

    const pool = new ProxyPool({ enabled: true, proxyListFile: file, failThreshold: 1 });
    const proxy = pool.acquire();
    pool.release(proxy, false);
    expect(pool.listDisabled()).toHaveLength(1);
  });

  it("throws when every proxy is disabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "fe-proxy-"));
    const file = join(dir, "proxy.txt");
    writeFileSync(file, "127.0.0.1:8080\n");
    const pool = new ProxyPool({ enabled: true, proxyListFile: file, failThreshold: 1 });
    const proxy = pool.acquire();
    pool.release(proxy, false);
    expect(() => pool.acquire()).toThrow(ProxyExhaustedError);
  });
});
