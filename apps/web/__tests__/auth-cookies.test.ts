import { afterEach, describe, expect, it, vi } from "vitest";

interface CapturedAuthConfig {
  cookies?: {
    sessionToken?: CapturedCookie;
    csrfToken?: CapturedCookie;
  };
}

interface CapturedCookie {
  name?: string;
  options?: { httpOnly?: boolean; sameSite?: string; path?: string; secure?: boolean };
}

const capturedConfigs = vi.hoisted(() => [] as CapturedAuthConfig[]);
const originalEnv = { ...process.env };

vi.mock("next-auth", () => ({
  default: (config: CapturedAuthConfig) => {
    capturedConfigs.push(config);
    return { auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() };
  }
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: (config: unknown) => config
}));
vi.mock("@/lib/auth/dingtalk-inapp-provider", () => ({
  DingtalkInAppProvider: vi.fn()
}));
vi.mock("@/lib/auth/dingtalk-provider", () => ({
  DingtalkProvider: vi.fn(),
  isDingtalkEnabled: () => false,
  isLocalLoginAllowed: () => true
}));
vi.mock("@/lib/auth/merge", () => ({
  mergeOrCreateUser: vi.fn(),
  UserDisabledError: class extends Error {}
}));
vi.mock("@/lib/auth/users", () => ({ findUserByUsername: vi.fn() }));
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: vi.fn(),
  BCRYPT_WORK_FACTOR: 12
}));
vi.mock("@/lib/auth/login-rate-limit", () => ({
  admitLogin: vi.fn(),
  resolveLoginClientIp: vi.fn(),
  rollbackLoginAdmit: vi.fn()
}));

async function cookieConfigFor(authUrl: string | undefined, nextAuthUrl: string | undefined) {
  vi.resetModules();
  capturedConfigs.length = 0;
  if (authUrl === undefined) delete process.env.AUTH_URL;
  else process.env.AUTH_URL = authUrl;
  if (nextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = nextAuthUrl;
  await import("../auth");
  return capturedConfigs.at(-1)?.cookies;
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("Auth.js embedded-browser cookie policy", () => {
  it("uses NEXTAUTH_URL HTTPS when AUTH_URL is absent", async () => {
    const cookies = await cookieConfigFor(undefined, "https://radar.example.com");
    const options = { httpOnly: true, sameSite: "none", path: "/", secure: true };

    expect(cookies?.sessionToken).toEqual({ name: "fe-radar.session-token", options });
    expect(cookies?.csrfToken).toEqual({ name: "__Host-authjs.csrf-token", options });
  });

  it("keeps HTTP cookies lax and non-secure", async () => {
    const cookies = await cookieConfigFor("http://10.1.20.156:3013", undefined);
    const options = { httpOnly: true, sameSite: "lax", path: "/", secure: false };

    expect(cookies?.sessionToken).toEqual({ name: "fe-radar.session-token", options });
    expect(cookies?.csrfToken).toEqual({ name: "authjs.csrf-token", options });
  });
});
