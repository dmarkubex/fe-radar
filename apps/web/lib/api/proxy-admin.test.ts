import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listDisabledProxies, reenableProxy } from "./proxy-admin";

describe("proxy admin", () => {
  it("lists disabled proxies from the configured state file", () => {
    const dir = mkdtempSync(join(tmpdir(), "fe-proxy-admin-"));
    const proxyListFile = join(dir, "proxies.txt");
    const disabledStateFile = join(dir, "disabled.json");
    writeFileSync(proxyListFile, "10.0.0.1:8080\nhttps://proxy.example:443\n");
    writeFileSync(disabledStateFile, JSON.stringify({ "proxy-2": { reason: "timeout", disabledAt: "2026-05-11T06:00:00.000Z", failCount: 3 } }));

    expect(listDisabledProxies({ proxyListFile, disabledStateFile })).toEqual([
      {
        id: "proxy-2",
        host: "proxy.example",
        port: "443",
        server: "https://proxy.example:443",
        reason: "timeout",
        disabledAt: "2026-05-11T06:00:00.000Z",
        failCount: 3
      }
    ]);
  });

  it("re-enables a disabled proxy by removing its state record", () => {
    const dir = mkdtempSync(join(tmpdir(), "fe-proxy-admin-"));
    const proxyListFile = join(dir, "proxies.txt");
    const disabledStateFile = join(dir, "disabled.json");
    writeFileSync(proxyListFile, "10.0.0.1:8080\n");
    writeFileSync(disabledStateFile, JSON.stringify({ "proxy-1": { reason: "timeout" } }));

    expect(reenableProxy("proxy-1", { proxyListFile, disabledStateFile })).toBe(true);
    expect(listDisabledProxies({ proxyListFile, disabledStateFile })).toEqual([]);
    expect(reenableProxy("proxy-1", { proxyListFile, disabledStateFile })).toBe(false);
  });
});
