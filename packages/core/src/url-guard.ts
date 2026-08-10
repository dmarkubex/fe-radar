/**
 * T-SEC-12: SSRF guard for outbound fetches (RSS / HTML / Playwright / quotes).
 *
 * 编辑员可配置任意语法有效 URL；Worker 在 robots / Undici / Playwright 路径中不限制
 * scheme / 端口 / 解析 IP，也不逐跳复验重定向。本模块在「实际 fetch 边界」集中判定：
 * 仅放行 http(s)、拒绝 URL 凭据、拒绝非标端口、解析全部 A/AAAA 并拒绝 loopback / private
 * / link-local / multicast / unspecified / 云 metadata。
 *
 * 防护策略：
 * - fail-closed：URL 解析失败或 DNS 解析失败 → 拒绝。
 * - DNS rebinding：调用方应在「每次实际连接前」调用本函数（非仅保存时一次）。
 * - 内部服务 allowlist：FETCH_INTERNAL_ALLOWLIST（hostname 逗号分隔）内的 hostname 跳过
 *   IP 范围检查（仍校验 scheme / port / userinfo），供容器内部 RSSHub / exchange-api 等使用。
 *
 * 纯函数 + node 内置 dns/net，无 db / worker 依赖，web 与 worker 都可 import。
 */

import dns from "node:dns";
import net from "node:net";

export interface UrlGuardResult {
  allowed: boolean;
  reason: string;
}

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/** 默认放行的标准端口（空 = 协议默认）。 */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

/**
 * 内部服务 hostname allowlist。从 FETCH_INTERNAL_ALLOWLIST 环境变量读取（逗号分隔），
 * 仅在模块加载时取一次；测试经 setInternalAllowlistForTests 注入。
 */
let internalAllowlist: Set<string> = parseAllowlist(process.env.FETCH_INTERNAL_ALLOWLIST);

function parseAllowlist(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0)
  );
}

/** 测试专用：覆盖 allowlist 并返回恢复函数。生产代码勿调。 */
export function setInternalAllowlistForTests(raw: string | undefined): () => void {
  const prev = internalAllowlist;
  internalAllowlist = parseAllowlist(raw);
  return () => {
    internalAllowlist = prev;
  };
}

/**
 * 判定 hostname 是否在 FETCH_INTERNAL_ALLOWLIST 内。
 * 供 worker http.ts 连接时 lookup 复验豁免内部服务（如 rsshub:1200 解析到私网 IP 属正常），
 * 与 assertPublicFetchUrl 的 allowlist 分支保持同一判定（去方括号 + 小写）。
 */
export function isInternalAllowlisted(hostname: string): boolean {
  return internalAllowlist.has(hostname.toLowerCase().replace(/^\[|\]$/g, ""));
}

/**
 * 判定一个出站 URL 是否可安全抓取。
 *
 * 注意：本函数会同步触发 dns.lookup（异步）。调用方应在实际 fetch 前调用，并对重定向
 * 的每一跳 Location 重新调用。
 */
export async function assertPublicFetchUrl(rawUrl: string): Promise<UrlGuardResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: "INVALID_URL" };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { allowed: false, reason: `SCHEME_BLOCKED:${parsed.protocol}` };
  }

  // 拒绝 URL 内嵌凭据（user:pass@）—— Node fetch 会透传，且常被误判为不同 origin。
  if (parsed.username !== "" || parsed.password !== "") {
    return { allowed: false, reason: "URL_CREDENTIALS_BLOCKED" };
  }

  // 复核 MEDIUM: URL.hostname 对 IPv6 字面量保留方括号（[::1]）；net.isIP 不认方括号，
  // 会落到 DNS 分支。去掉方括号让 IP 字面量走 IP 范围判定。
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // 明确字面量 metadata IP（即使 allowlist 也不放行，防误配）。
  // 含 IPv4-mapped IPv6 形式（WHATWG 会把 [::ffff:169.254.169.254] 规范成 ::ffff:a9fe:a9fe）。
  if (isMetadataHostname(hostname)) {
    return { allowed: false, reason: "METADATA_IP_BLOCKED" };
  }

  // 内部服务 allowlist：跳过端口与 IP 范围检查（容器内部服务常用非标端口 + 私网 IP，
  // 如 RSSHub 的 rsshub:1200）。仍保留 scheme 与 userinfo 校验。
  if (internalAllowlist.has(hostname)) {
    return { allowed: true, reason: "INTERNAL_ALLOWLISTED" };
  }

  if (!ALLOWED_PORTS.has(parsed.port)) {
    return { allowed: false, reason: `PORT_BLOCKED:${parsed.port || "default"}` };
  }

  // 如果 hostname 本身就是 IP 字面量，直接判 IP 范围。
  const ipKind = net.isIP(hostname);
  if (ipKind !== 0) {
    return isPrivateIp(hostname, ipKind)
      ? { allowed: false, reason: `IP_RANGE_BLOCKED:${hostname}` }
      : { allowed: true, reason: "PUBLIC_IP_LITERAL" };
  }

  // 域名 → 解析全部 A/AAAA，任一解析地址落入私网即拒绝（fail-closed on DNS error）。
  let addrs: string[];
  try {
    const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    addrs = records.map((r) => r.address);
  } catch {
    return { allowed: false, reason: "DNS_LOOKUP_FAILED" };
  }

  if (addrs.length === 0) {
    return { allowed: false, reason: "DNS_NO_RECORDS" };
  }

  for (const addr of addrs) {
    if (isPrivateIp(addr, net.isIP(addr))) {
      return { allowed: false, reason: `RESOLVED_PRIVATE:${addr}` };
    }
  }

  return { allowed: true, reason: "PUBLIC_HOSTNAME" };
}

/**
 * 判定 IP 字面量是否落入禁止范围。
 * - loopback：127/8、::1
 * - private：10/8、172.16/12、192.168/16、fc00::/7（含 fd00 ULA）
 * - link-local：169.254/16、fe80::/10
 * - multicast：224/4、ff00::/8
 * - unspecified：0.0.0.0、::
 */
export function isPrivateIp(ip: string, kind: number = net.isIP(ip)): boolean {
  if (kind === 4) {
    return isPrivateV4(ip);
  }
  if (kind === 6) {
    return isPrivateV6(ip);
  }
  // 无法识别的格式按私网处理（fail-closed）。
  return true;
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true;
  }
  const a = parts[0]!;
  const b = parts[1]!;

  if (a === 127) return true; // loopback
  if (a === 10) return true; // private 10/8
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16/12
  if (a === 192 && b === 168) return true; // private 192.168/16
  if (a === 169 && b === 254) return true; // link-local 169.254/16（含 metadata）
  if (a === 0) return true; // unspecified 0.0.0.0 / 本网
  // 复核 F5: 100.64/10 (RFC6598 carrier-grade NAT) — 云厂商 metadata（阿里云 100.100.100.200）走此段。
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 复核 F5: benchmarking 198.18/15 (RFC2544) — 部分内网/测试用此段，按敏感处理。
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // multicast 224/4 + reserved 240/4
  return false;
}

/**
 * 云 metadata 主机名黑名单。独立于 isPrivateIp：即使 allowlist 也不放行。
 * 必须识别 IPv4-mapped IPv6（十六进制组 + 点分两种书写）。
 */
function isMetadataHostname(hostname: string): boolean {
  if (hostname === "169.254.169.254" || hostname === "fd00:ec2::254") {
    return true;
  }
  const mappedV4 = extractIpv4MappedV4(hostname);
  return mappedV4 === "169.254.169.254";
}

/**
 * 将 IPv6 字面量展开为 16 字节。支持 `::` 压缩与末尾点分 IPv4（RFC 4291）。
 * 无法解析返回 null（调用方 fail-closed 或跳过映射分支）。
 */
function parseIpv6Bytes(ip: string): Uint8Array | null {
  let working = ip.toLowerCase();

  // 末尾 :a.b.c.d → 拆成两个 16-bit 十六进制组，统一后续解析路径。
  const dottedTail = working.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dottedTail) {
    const octets = dottedTail[2]!.split(".").map((p) => Number(p));
    if (octets.length !== 4 || octets.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return null;
    }
    const hi = ((octets[0]! << 8) | octets[1]!).toString(16);
    const lo = ((octets[2]! << 8) | octets[3]!).toString(16);
    working = `${dottedTail[1]}${hi}:${lo}`;
  }

  const sides = working.split("::");
  if (sides.length > 2) return null;

  const parseGroups = (side: string | undefined): number[] | null => {
    if (side === undefined || side === "") return [];
    const out: number[] = [];
    for (const g of side.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const left = parseGroups(sides[0]);
  if (left === null) return null;

  let groups: number[];
  if (sides.length === 2) {
    const right = parseGroups(sides[1]);
    if (right === null) return null;
    const total = left.length + right.length;
    if (total > 7) return null;
    groups = [...left, ...Array<number>(8 - total).fill(0), ...right];
  } else {
    if (left.length !== 8) return null;
    groups = left;
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const g = groups[i]!;
    bytes[i * 2] = (g >> 8) & 0xff;
    bytes[i * 2 + 1] = g & 0xff;
  }
  return bytes;
}

/**
 * 若 ip 为 IPv4-mapped IPv6（::ffff/96），返回映射的点分 IPv4；否则 null。
 * 同时覆盖 WHATWG 规范化后的十六进制组（::ffff:7f00:1）与点分（::ffff:127.0.0.1）。
 */
function extractIpv4MappedV4(ip: string): string | null {
  const bytes = parseIpv6Bytes(ip);
  if (!bytes) return null;
  // ::ffff:0:0/96 → 前 10 字节为 0，字节 10–11 为 0xff 0xff
  for (let i = 0; i < 10; i++) {
    if (bytes[i] !== 0) return null;
  }
  if (bytes[10] !== 0xff || bytes[11] !== 0xff) return null;
  return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // 规范化部分常见缩写以便前缀判断。
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true; // loopback
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0") return true; // unspecified

  // IPv4-mapped ::ffff/96：先还原末 32 位再复用 isPrivateV4。
  // 必须在 fe/fc/fd/ff 前缀字符串检查之前——否则不会误伤，但死代码正则曾漏掉十六进制组形式。
  const mappedV4 = extractIpv4MappedV4(lower);
  if (mappedV4 !== null) {
    return isPrivateV4(mappedV4);
  }

  // link-local fe80::/10
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true;
  }
  // unique-local fc00::/7（fc.. 与 fd..）
  if (lower.startsWith("fc") || lower.startsWith("fd")) {
    return true;
  }
  // multicast ff00::/8
  if (lower.startsWith("ff")) {
    return true;
  }
  return false;
}
