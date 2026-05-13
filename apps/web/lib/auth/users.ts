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

export async function findUserByUsername(username: string): Promise<AuthUser | null> {
  if (isMockMode()) {
    if (username !== "admin" && username !== "viewer") return null;
    return {
      id: username === "admin" ? "1" : "2",
      username,
      name: username === "admin" ? "Mock 管理员" : "Mock 访客",
      role: username === "admin" ? "admin" : "viewer",
      passwordHash: await bcrypt.hash(
        username === "admin" ? "admin123456" : "viewer123456",
        BCRYPT_WORK_FACTOR
      ),
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
