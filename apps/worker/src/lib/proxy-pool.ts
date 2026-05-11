import { readFileSync } from "node:fs";

export interface ProxyEndpoint {
  id: string;
  server: string;
  disabled: boolean;
  failCount: number;
}

export interface AcquireProxyOptions {
  retry?: boolean;
}

export interface ProxyPoolOptions {
  enabled?: boolean;
  proxyListFile?: string;
  failThreshold?: number;
}

export class ProxyExhaustedError extends Error {
  public constructor() {
    super("No healthy proxy is available");
    this.name = "ProxyExhaustedError";
  }
}

export class ProxyPool {
  private readonly proxies: ProxyEndpoint[];
  private readonly enabled: boolean;
  private readonly failThreshold: number;
  private cursor = 0;

  public constructor(options: ProxyPoolOptions = {}) {
    this.enabled = options.enabled ?? process.env.PROXY_POOL_ENABLED === "true";
    this.failThreshold = options.failThreshold ?? Number(process.env.PROXY_HEALTH_FAIL_THRESHOLD ?? 3);
    const file = options.proxyListFile ?? process.env.PROXY_LIST_FILE;
    this.proxies = this.enabled && file ? loadProxyList(file) : [];
  }

  public acquire(options: AcquireProxyOptions = {}): ProxyEndpoint | undefined {
    if (!this.enabled) {
      return undefined;
    }

    const healthy = this.proxies.filter((proxy) => !proxy.disabled);
    if (healthy.length === 0) {
      throw new ProxyExhaustedError();
    }

    if (options.retry) {
      this.cursor += 1;
    }

    const proxy = healthy[this.cursor % healthy.length];
    this.cursor += 1;
    return proxy;
  }

  public release(proxy: ProxyEndpoint | undefined, ok: boolean): void {
    if (!proxy) {
      return;
    }

    if (ok) {
      proxy.failCount = 0;
      return;
    }

    proxy.failCount += 1;
    if (proxy.failCount >= this.failThreshold) {
      proxy.disabled = true;
    }
  }

  public listDisabled(): ProxyEndpoint[] {
    return this.proxies.filter((proxy) => proxy.disabled);
  }

  public reenable(id: string): boolean {
    const proxy = this.proxies.find((candidate) => candidate.id === id);
    if (!proxy) {
      return false;
    }
    proxy.disabled = false;
    proxy.failCount = 0;
    return true;
  }
}

export function loadProxyList(file: string): ProxyEndpoint[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line, index) => {
      const server = line.includes("://") ? line : `http://${line}`;
      return {
        id: `proxy-${index + 1}`,
        server,
        disabled: false,
        failCount: 0
      };
    });
}

export const proxyPool = new ProxyPool();
