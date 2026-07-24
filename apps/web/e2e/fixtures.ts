import { randomUUID } from "node:crypto";
import {
  expect,
  test as base,
  type APIRequestContext,
  type Locator,
  type Page
} from "@playwright/test";

export type TestRole = "admin" | "editor" | "viewer";

interface Credentials {
  username: string;
  password: string;
}

interface Fixtures {
  login(role: TestRole, callbackUrl?: string): Promise<void>;
}

function envCredentials(role: TestRole): Credentials | null {
  const prefix = role.toUpperCase();
  const username =
    process.env[`E2E_${prefix}_USERNAME`] ??
    process.env[`SEED_${prefix}_USERNAME`] ??
    (role === "admin" ? "admin" : role === "viewer" ? "viewer" : undefined);
  const password =
    process.env[`E2E_${prefix}_PASSWORD`] ??
    process.env[`SEED_${prefix}_PASSWORD`];
  return username && password ? { username, password } : null;
}

export async function authenticate(
  request: APIRequestContext,
  credentials: Credentials,
  callbackUrl = "/"
): Promise<void> {
  const csrfResponse = await request.get("/api/auth/csrf");
  expect(csrfResponse.ok(), "GET /api/auth/csrf").toBe(true);
  const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
  const response = await request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken,
      username: credentials.username,
      password: credentials.password,
      callbackUrl
    },
    maxRedirects: 0
  });
  expect([302, 303], "credentials login redirect").toContain(response.status());
  expect(response.headers().location ?? "", "credentials login result").not.toContain(
    "error=CredentialsSignin"
  );
}

export function credentialsFor(role: TestRole): Credentials | null {
  return envCredentials(role);
}

export const test = base.extend<Fixtures>({
  login: async ({ page }, use) => {
    const bootstrappedEditorIds: number[] = [];

    async function login(role: TestRole, callbackUrl = "/"): Promise<void> {
      await page.context().clearCookies();
      let credentials = envCredentials(role);

      if (!credentials && role === "editor") {
        if (process.env.APP_DATA_MODE === "mock") {
          throw new Error(
            "editor RBAC requires E2E_EDITOR_* credentials or migrated Postgres; mock auth only provides admin/viewer"
          );
        }
        const admin = envCredentials("admin");
        if (!admin) {
          throw new Error(
            "editor RBAC requires E2E_EDITOR_* (or SEED_EDITOR_*) credentials, or admin credentials for secure bootstrap"
          );
        }

        await authenticate(page.request, admin, "/admin/users");
        const suffix = randomUUID().slice(0, 8);
        credentials = {
          username: `e2e-editor-${suffix}`,
          password: `E2e-${randomUUID()}`
        };
        const response = await page.request.post("/api/users", {
          data: {
            username: credentials.username,
            password: credentials.password,
            name: `E2E Editor ${suffix}`,
            dept: "E2E",
            role: "editor"
          }
        });
        expect(response.status(), "bootstrap editor").toBe(201);
        const created = await response.json() as { id: number };
        bootstrappedEditorIds.push(created.id);
        await page.context().clearCookies();
      }

      if (!credentials) {
        throw new Error(
          `${role} login requires E2E_${role.toUpperCase()}_PASSWORD or SEED_${role.toUpperCase()}_PASSWORD`
        );
      }
      await authenticate(page.request, credentials, callbackUrl);
    }

    await use(login);

    if (bootstrappedEditorIds.length > 0) {
      const admin = envCredentials("admin");
      if (admin) {
        await page.context().clearCookies();
        await authenticate(page.request, admin, "/admin/users");
        await Promise.all(
          bootstrappedEditorIds.map((id) =>
            page.request.put(`/api/users/${id}`, { data: { disabled: true } })
          )
        );
      }
    }
  }
});

export { expect };
export type { Locator, Page };
