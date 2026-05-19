import { getDb, users } from "@fe-radar/db";
import type { UserRole } from "@fe-radar/shared";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { isMockMode } from "../mock-mode";
import { BCRYPT_WORK_FACTOR } from "./password";

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  disabledAt?: Date | null;
}

type MockUsername = "admin" | "viewer";

const MOCK_PASSWORDS: Record<MockUsername, string> = {
  admin: "admin123456",
  viewer: "viewer123456"
};

const mockPasswordHashPromises: Partial<Record<MockUsername, Promise<string>>> = {};

function isMockUsername(username: string): username is MockUsername {
  return username === "admin" || username === "viewer";
}

function getMockPasswordHash(username: MockUsername): Promise<string> {
  mockPasswordHashPromises[username] ??= bcrypt.hash(MOCK_PASSWORDS[username], BCRYPT_WORK_FACTOR);
  return mockPasswordHashPromises[username];
}

export async function findUserByUsername(username: string): Promise<AuthUser | null> {
  if (process.env.NODE_ENV !== "production" && isMockMode()) {
    if (!isMockUsername(username)) return null;
    return {
      id: username === "admin" ? "1" : "2",
      username,
      name: username === "admin" ? "Mock 管理员" : "Mock 访客",
      role: username === "admin" ? "admin" : "viewer",
      passwordHash: await getMockPasswordHash(username),
      disabledAt: null
    };
  }
  const [user] = await getDb().select().from(users).where(eq(users.username, username)).limit(1);
  if (!user?.username || !user.passwordHash) {
    return null;
  }

  return {
    id: String(user.id),
    username: user.username,
    name: user.name,
    role: user.role as UserRole,
    passwordHash: user.passwordHash,
    disabledAt: user.disabledAt
  };
}
