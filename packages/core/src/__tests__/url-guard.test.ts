import { afterEach, describe, expect, it, vi } from "vitest";
import type * as NodeDns from "node:dns";
import type { LookupAddress } from "node:dns";
import {
  assertPublicFetchUrl,
  isInternalAllowlisted,
  isPrivateIp,
  setInternalAllowlistForTests
} from "../url-guard";

function rec(address: string, family: 4 | 6): LookupAddress {
  return { address, family };
}

/** mockResolvedValue 在 lookup 重载下推不出数组签名，统一用一个包装规避。 */
function mockLookup(dns: typeof NodeDns, addrs: LookupAddress[]) {
  return vi.spyOn(dns.promises, "lookup").mockImplementation((() => Promise.resolve(addrs)) as never);
}

describe("isPrivateIp", () => {
  it("flags IPv4 loopback / private / link-local / multicast / unspecified", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.1.2.3")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true); // metadata
    expect(isPrivateIp("0.0.0.0")).toBe(true);
    expect(isPrivateIp("224.0.0.1")).toBe(true); // multicast
    expect(isPrivateIp("240.0.0.1")).toBe(true); // reserved
    // 复核 F5: carrier-grade NAT 100.64/10（阿里云 metadata 100.100.100.200 走此段）必须拦截。
    expect(isPrivateIp("100.100.100.200")).toBe(true);
    expect(isPrivateIp("100.64.0.1")).toBe(true);
    expect(isPrivateIp("100.127.255.255")).toBe(true);
    expect(isPrivateIp("198.18.0.1")).toBe(true); // benchmarking 198.18/15
    expect(isPrivateIp("169.254.169.254")).toBe(true); // metadata
    expect(isPrivateIp("0.0.0.0")).toBe(true);
    expect(isPrivateIp("224.0.0.1")).toBe(true); // multicast
    expect(isPrivateIp("240.0.0.1")).toBe(true); // reserved
  });

  it("accepts public IPv4", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false); // just outside 172.16/12
    expect(isPrivateIp("11.0.0.1")).toBe(false);
  });

  it("flags IPv6 loopback / link-local / ULA / multicast / unspecified", () => {
    expect(isPrivateIp("::1", 6)).toBe(true);
    expect(isPrivateIp("::", 6)).toBe(true);
    expect(isPrivateIp("fe80::1", 6)).toBe(true);
    expect(isPrivateIp("fd00::1", 6)).toBe(true);
    expect(isPrivateIp("fc00::1", 6)).toBe(true);
    expect(isPrivateIp("ff02::1", 6)).toBe(true);
    expect(isPrivateIp("::ffff:192.168.1.1", 6)).toBe(true); // v4-mapped private
  });

  // S1: WHATWG 规范化后的十六进制组形式（::ffff:7f00:1 = 127.0.0.1）此前 isPrivateIp 恒 false。
  it("flags IPv4-mapped IPv6 in hex-group form (SSRF bypass fix)", () => {
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true); // 127.0.0.1
    expect(isPrivateIp("::ffff:a9fe:a9fe")).toBe(true); // 169.254.169.254 metadata
    expect(isPrivateIp("::ffff:0a00:1")).toBe(true); // 10.0.0.1
    expect(isPrivateIp("0:0:0:0:0:ffff:7f00:1")).toBe(true); // full form loopback
  });

  it("accepts public IPv6", () => {
    expect(isPrivateIp("2606:4700:4700::1111", 6)).toBe(false);
    expect(isPrivateIp("::ffff:8.8.8.8", 6)).toBe(false); // v4-mapped public
    expect(isPrivateIp("::ffff:0808:0808")).toBe(false); // 8.8.8.8 hex-group form
  });

  it("fail-closed on unparseable", () => {
    expect(isPrivateIp("not-an-ip", 0)).toBe(true);
  });
});

describe("assertPublicFetchUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects non-http schemes including javascript: / data:", async () => {
    expect((await assertPublicFetchUrl("javascript:alert(1)")).allowed).toBe(false);
    expect((await assertPublicFetchUrl("data:text/html,hi")).allowed).toBe(false);
    expect((await assertPublicFetchUrl("ftp://example.com/")).allowed).toBe(false);
  });

  it("rejects URL credentials", async () => {
    expect((await assertPublicFetchUrl("http://user:pass@example.com/")).allowed).toBe(false);
  });

  it("rejects non-standard ports", async () => {
    expect((await assertPublicFetchUrl("http://example.com:8080/")).allowed).toBe(false);
    expect((await assertPublicFetchUrl("http://example.com:6379/")).allowed).toBe(false);
  });

  it("rejects literal metadata IP", async () => {
    expect((await assertPublicFetchUrl("http://169.254.169.254/latest/meta-data/")).allowed).toBe(false);
  });

  it("rejects literal private / loopback IPv4", async () => {
    expect((await assertPublicFetchUrl("http://127.0.0.1/")).allowed).toBe(false);
    expect((await assertPublicFetchUrl("http://10.0.0.1/")).allowed).toBe(false);
    expect((await assertPublicFetchUrl("http://192.168.1.1/")).allowed).toBe(false);
  });

  it("rejects bracketed IPv6 loopback / link-local literals (复核 MEDIUM)", async () => {
    // URL.hostname 保留方括号；去掉方括号后才走 IP 范围判定，否则会误落 DNS 分支。
    expect((await assertPublicFetchUrl("http://[::1]/")).allowed).toBe(false);
    expect((await assertPublicFetchUrl("http://[fe80::1]/")).allowed).toBe(false);
    expect((await assertPublicFetchUrl("http://[fd00::1]/")).allowed).toBe(false);
  });

  // S1 Critical: IPv4-mapped IPv6 SSRF 绕过。WHATWG 会把点分规范成十六进制组；两种书写都必须拒。
  it("rejects IPv4-mapped IPv6 loopback and metadata (dotted + hex-group)", async () => {
    expect((await assertPublicFetchUrl("http://[::ffff:127.0.0.1]/")).allowed).toBe(false);
    expect((await assertPublicFetchUrl("http://[::ffff:7f00:1]/")).allowed).toBe(false);
    expect(
      (await assertPublicFetchUrl("http://[::ffff:169.254.169.254]/latest/meta-data")).allowed
    ).toBe(false);
    expect(
      (await assertPublicFetchUrl("http://[::ffff:a9fe:a9fe]/latest/meta-data")).allowed
    ).toBe(false);
  });

  it("allows literal public IPv4", async () => {
    expect((await assertPublicFetchUrl("http://8.8.8.8/")).allowed).toBe(true);
  });

  it("allows public hostname and public IPv6 literal (v4-mapped fix regression)", async () => {
    const dns = await import("node:dns");
    mockLookup(dns, [rec("93.184.216.34", 4)]);
    expect((await assertPublicFetchUrl("https://example.com/")).allowed).toBe(true);
    vi.restoreAllMocks();
    // Cloudflare DNS — 真实公网 IPv6，不得被 v4-mapped 修复误伤
    expect((await assertPublicFetchUrl("http://[2606:4700:4700::1111]/")).allowed).toBe(true);
  });

  it("rejects hostname resolving to private IP (DNS)", async () => {
    const dns = await import("node:dns");
    mockLookup(dns, [rec("10.1.2.3", 4)]);
    expect((await assertPublicFetchUrl("https://internal.example.com/")).allowed).toBe(false);
    vi.restoreAllMocks();
  });

  it("allows hostname resolving to public IP (DNS)", async () => {
    const dns = await import("node:dns");
    mockLookup(dns, [rec("93.184.216.34", 4)]);
    expect((await assertPublicFetchUrl("https://example.com/")).allowed).toBe(true);
    vi.restoreAllMocks();
  });

  it("rejects when any resolved address is private (mixed)", async () => {
    const dns = await import("node:dns");
    mockLookup(dns, [rec("93.184.216.34", 4), rec("127.0.0.1", 4)]);
    expect((await assertPublicFetchUrl("https://rebind.example.com/")).allowed).toBe(false);
    vi.restoreAllMocks();
  });

  it("fail-closed on DNS lookup failure", async () => {
    const dns = await import("node:dns");
    vi.spyOn(dns.promises, "lookup").mockImplementation(() => Promise.reject(new Error("ENOTFOUND")));
    expect((await assertPublicFetchUrl("https://nx.example.com/")).allowed).toBe(false);
    vi.restoreAllMocks();
  });

  it("allows allowlisted internal hostname despite private resolution", async () => {
    const restore = setInternalAllowlistForTests("rsshub,exchange-api.local");
    try {
      const dns = await import("node:dns");
      const spy = mockLookup(dns, [rec("172.20.0.5", 4)]);
      const r = await assertPublicFetchUrl("http://rsshub:1200/");
      expect(r.allowed).toBe(true);
      // allowlist 跳过 DNS，不调用 lookup
      expect(spy).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    } finally {
      restore();
    }
  });

  it("allowlisted hostname still rejects bad scheme and userinfo (port is relaxed for internal services)", async () => {
    const restore = setInternalAllowlistForTests("rsshub");
    try {
      // 非法 scheme 仍拒
      expect((await assertPublicFetchUrl("ftp://rsshub:1200/")).allowed).toBe(false);
      // URL 凭据仍拒
      expect((await assertPublicFetchUrl("http://u:p@rsshub/")).allowed).toBe(false);
      // 非标端口对 allowlisted 内部服务放行（RSSHub 常用 1200）
      expect((await assertPublicFetchUrl("http://rsshub:1200/")).allowed).toBe(true);
    } finally {
      restore();
    }
  });

  it("rejects invalid URL", async () => {
    expect((await assertPublicFetchUrl("not a url")).allowed).toBe(false);
    expect((await assertPublicFetchUrl("")).allowed).toBe(false);
  });
});

describe("isInternalAllowlisted", () => {
  it("matches allowlisted hostnames case-insensitively and strips IPv6 brackets", () => {
    const restore = setInternalAllowlistForTests("rsshub,exchange-api.local");
    try {
      expect(isInternalAllowlisted("rsshub")).toBe(true);
      expect(isInternalAllowlisted("RSSHub")).toBe(true);
      expect(isInternalAllowlisted("exchange-api.local")).toBe(true);
      expect(isInternalAllowlisted("example.com")).toBe(false);
    } finally {
      restore();
    }
  });
});
