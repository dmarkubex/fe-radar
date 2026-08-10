import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { DingtalkInAppProvider } from "@/lib/auth/dingtalk-inapp-provider";
import { DingtalkProvider, isDingtalkEnabled, isLocalLoginAllowed } from "@/lib/auth/dingtalk-provider";
import { mergeOrCreateUser, UserDisabledError } from "@/lib/auth/merge";
import { findUserByUsername } from "@/lib/auth/users";
import { verifyPassword, BCRYPT_WORK_FACTOR } from "@/lib/auth/password";
import { admitLogin, resolveLoginClientIp, rollbackLoginAdmit } from "@/lib/auth/login-rate-limit";
import bcrypt from "bcryptjs";

// T-SEC-08: 用于「用户不存在」分支的 dummy bcrypt，让响应时间与真实失败一致，防存在性 oracle。
// 预计算一次（启动期 lazy）。
let dummyHash: string | null = null;
async function getDummyHash(): Promise<string> {
  if (!dummyHash) {
    dummyHash = await bcrypt.hash("__no_such_user__", BCRYPT_WORK_FACTOR);
  }
  return dummyHash;
}

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

// A-7: 空字符串 AUTH_URL 不得遮蔽有效 NEXTAUTH_URL（?? 只跳过 null/undefined）。
// 与 instrumentation.resolveConfiguredAuthUrl 同语义：取第一个 trim 后非空。
function resolveConfiguredAuthUrl(): string {
  for (const v of [process.env.AUTH_URL, process.env.NEXTAUTH_URL]) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return "";
}

const authUrl = resolveConfiguredAuthUrl();
const useSecureCookie = authUrl ? authUrl.startsWith("https://") : process.env.NODE_ENV === "production";

// T-SEC-16 (复核): 生产 HTTPS origin 断言已移到 instrumentation.ts register（启动钩子），
// 避免在 next build 的 page-data 阶段（NODE_ENV=production 但非真实启动）误触发导致构建挂。

export const { auth, handlers, signIn, signOut } = NextAuth({
  trustHost: process.env.AUTH_TRUST_HOST !== "false",
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 2,
    updateAge: 60 * 15
  },
  providers: [
    Credentials({
      credentials: {
        username: { label: "用户名", type: "text" },
        password: { label: "密码", type: "password" }
      },
      async authorize(rawCredentials, request) {
        // Emergency break-glass gate: when DingTalk SSO is enabled, local
        // credential login is rejected unless EMERGENCY_LOCAL_LOGIN=true.
        // This is the real control — UI hiding alone is not. (Antigravity #1)
        if (!isLocalLoginAllowed()) {
          return null;
        }

        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) {
          return null;
        }

        // S2: bcrypt 前原子预占（读→超限拒→否则 INCR）。失败保留预占；成功 DECR 回滚。
        // A-4（方案 b）：Auth.js authorize 收到标准 Web Request，无 peer IP；
        // Next.js 15 NextRequest 亦已移除 .ip。当前 Swarm 直发无可信反代重写 XFF，
        // TRUST_PROXY_HEADERS 默认关闭 → IP 维度不可用，仅 username 限速生效。
        // 启用 IP 维度：前置会重写 XFF 的可信代理后设 TRUST_PROXY_HEADERS=true
        // （见 docs/runbook/deploy-portainer.md § 登录限速 / TRUST_PROXY_HEADERS）。
        // Redis 不可达 fail-open。不要再读 request.ip（永远 undefined，属死代码伪装）。
        const xff = request?.headers?.get?.("x-forwarded-for") ?? null;
        const ip = resolveLoginClientIp(xff, null);
        if (!(await admitLogin(parsed.data.username, ip))) {
          return null;
        }

        const user = await findUserByUsername(parsed.data.username);
        if (!user || user.disabledAt) {
          // dummy bcrypt：让用户不存在的响应时间与真实密码校验一致，防存在性 oracle。
          // 失败：保留预占（不再二次 INCR）。
          await verifyPassword(parsed.data.password, await getDummyHash());
          return null;
        }

        const ok = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!ok) {
          // 失败：保留预占（不再二次 INCR）。
          return null;
        }

        // 成功：回滚本次预占（DECR，非 DEL）。
        await rollbackLoginAdmit(parsed.data.username, ip);

        return {
          id: user.id,
          name: user.name,
          email: `${user.username}@fe-radar.local`,
          role: user.role,
          tokenVersion: user.tokenVersion
        };
      }
    }),
    ...(isDingtalkEnabled() ? [DingtalkProvider(), DingtalkInAppProvider()] : [])
  ],
  pages: {
    signIn: "/auth/login"
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "dingtalk") {
        return true;
      }
      const rawProfile = profile as { unionid?: string; name?: string; dept?: string | null } | undefined;
      if (!rawProfile?.unionid || !rawProfile.name) {
        return false;
      }
      try {
        const merged = await mergeOrCreateUser({
          unionid: rawProfile.unionid,
          name: rawProfile.name,
          dept: rawProfile.dept ?? null
        });
        user.id = String(merged.id);
        user.name = merged.name;
        user.role = merged.role;
        // 复核 F8: 钉钉登录也写 tokenVersion，让撤权对钉钉会话同样生效。
        (user as { tokenVersion?: number }).tokenVersion = merged.tokenVersion;
        return true;
      } catch (err) {
        // FR-05a: disabled accounts rejected for QR and in-app free-login alike.
        if (err instanceof UserDisabledError) {
          return false;
        }
        throw err;
      }
    },
    jwt({ token, user }) {
      if (user && "role" in user) {
        token.role = user.role;
        if (user.id) {
          token.sub = user.id;
        }
        // T-SEC-06: 登录时写入当前 token_version；特权 API 的 route handler 经 requireFreshRole
        // 校验与 DB 当前值一致，不符即 401（禁用/降权/改密码时递增 token_version 使旧 JWT 失效）。
        if (typeof (user as { tokenVersion?: number }).tokenVersion === "number") {
          token.tokenVersion = (user as { tokenVersion: number }).tokenVersion;
        }
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
        if (token.sub) {
          session.user.id = token.sub;
        }
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) {
        return `${baseUrl}${url}`;
      }
      return new URL(url).origin === baseUrl ? url : baseUrl;
    }
  },
  cookies: {
    sessionToken: {
      name: "fe-radar.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookie
      }
    }
  }
});
