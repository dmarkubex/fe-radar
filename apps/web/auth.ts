import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { DingtalkInAppProvider } from "@/lib/auth/dingtalk-inapp-provider";
import { DingtalkProvider, isDingtalkEnabled, isLocalLoginAllowed } from "@/lib/auth/dingtalk-provider";
import { mergeOrCreateUser, UserDisabledError } from "@/lib/auth/merge";
import { findUserByUsername } from "@/lib/auth/users";
import { verifyPassword } from "@/lib/auth/password";

const credentialsSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const authUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
const useSecureCookie = authUrl ? authUrl.startsWith("https://") : process.env.NODE_ENV === "production";

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
      async authorize(rawCredentials) {
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

        const user = await findUserByUsername(parsed.data.username);
        if (!user || user.disabledAt) {
          return null;
        }

        const ok = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!ok) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: `${user.username}@fe-radar.local`,
          role: user.role
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
