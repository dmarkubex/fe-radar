import { readFileSync, writeFileSync } from "node:fs";

export interface DisabledProxy {
  id: string;
  host: string;
  port: string;
  server: string;
  reason: string;
  disabledAt: string | null;
  failCount: number;
}

interface ProxyEntry {
  id: string;
  host: string;
  port: string;
  server: string;
}

interface ProxyDisabledRecord {
  reason?: string;
  disabledAt?: string;
  failCount?: number;
}

type ProxyDisabledState = Record<string, ProxyDisabledRecord>;

export interface ProxyAdminStore {
  proxyListFile?: string;
  disabledStateFile?: string;
}

function parseProxyEntry(line: string, index: number): ProxyEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const server = trimmed.includes("://") ? trimmed : `http://${trimmed}`;
  const url = new URL(server);
  return {
    id: `proxy-${index + 1}`,
    host: url.hostname,
    port: url.port || (url.protocol === "https:" ? "443" : "80"),
    server
  };
}

function readProxyEntries(proxyListFile: string | undefined): ProxyEntry[] {
  if (!proxyListFile) {
    return [];
  }
  return readFileSync(proxyListFile, "utf8")
    .split(/\r?\n/)
    .map(parseProxyEntry)
    .filter((entry): entry is ProxyEntry => entry !== null);
}

function readDisabledState(disabledStateFile: string | undefined): ProxyDisabledState {
  if (!disabledStateFile) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(disabledStateFile, "utf8")) as ProxyDisabledState;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function writeDisabledState(disabledStateFile: string | undefined, state: ProxyDisabledState): void {
  if (!disabledStateFile) {
    return;
  }
  writeFileSync(disabledStateFile, `${JSON.stringify(state, null, 2)}\n`);
}

export function defaultProxyAdminStore(): ProxyAdminStore {
  return {
    proxyListFile: process.env.PROXY_LIST_FILE,
    disabledStateFile: process.env.PROXY_DISABLED_FILE ?? process.env.PROXY_STATE_FILE
  };
}

export function listDisabledProxies(store: ProxyAdminStore = defaultProxyAdminStore()): DisabledProxy[] {
  const entries = readProxyEntries(store.proxyListFile);
  const state = readDisabledState(store.disabledStateFile);
  return entries.flatMap((entry) => {
    const disabled = state[entry.id];
    if (!disabled) {
      return [];
    }
    return [{
      ...entry,
      reason: disabled.reason ?? "健康检查失败",
      disabledAt: disabled.disabledAt ?? null,
      failCount: disabled.failCount ?? 0
    }];
  });
}

export function reenableProxy(id: string, store: ProxyAdminStore = defaultProxyAdminStore()): boolean {
  const state = readDisabledState(store.disabledStateFile);
  if (!state[id]) {
    return false;
  }
  delete state[id];
  writeDisabledState(store.disabledStateFile, state);
  return true;
}
