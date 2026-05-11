import type { UserRole } from "@fe-radar/shared";

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  disabledAt?: Date | null;
}

export async function findUserByUsername(username: string): Promise<AuthUser | null> {
  void username;
  return null;
}
