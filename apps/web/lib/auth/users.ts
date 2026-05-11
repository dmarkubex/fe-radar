import { getDb, users } from "@fe-radar/db";
import type { UserRole } from "@fe-radar/shared";
import { eq } from "drizzle-orm";

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  disabledAt?: Date | null;
}

export async function findUserByUsername(username: string): Promise<AuthUser | null> {
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
