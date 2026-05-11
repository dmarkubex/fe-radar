import type { UserRole } from "@fe-radar/shared";

const ROLE_RANK: Record<UserRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3
};

export function hasRole(role: UserRole | undefined, required: UserRole): boolean {
  if (!role) {
    return false;
  }
  return ROLE_RANK[role] >= ROLE_RANK[required];
}
