import { getDb, mergeConflicts, users } from "@fe-radar/db";
import { desc, eq } from "drizzle-orm";
import { UsersAdmin } from "@/components/users/users-admin";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage(): Promise<React.JSX.Element> {
  const [userRows, conflictRows] = await Promise.all([
    getDb().select({
      id: users.id,
      username: users.username,
      dingtalkId: users.dingtalkId,
      name: users.name,
      dept: users.dept,
      role: users.role,
      disabledAt: users.disabledAt
    }).from(users).orderBy(desc(users.id)),
    getDb().select().from(mergeConflicts).where(eq(mergeConflicts.status, "pending")).orderBy(desc(mergeConflicts.createdAt))
  ]);
  const mergeConflictPayload = conflictRows.map((item) => ({
    id: item.id,
    unionid: item.unionid,
    name: item.name,
    dept: item.dept,
    candidateIds: item.candidateIds
  }));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
      <header>
        <p className="text-sm font-medium text-zinc-500">后台</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-950">用户管理</h1>
      </header>
      <UsersAdmin users={userRows.map((item) => ({ ...item, disabledAt: item.disabledAt?.toISOString() ?? null }))} mergeConflicts={mergeConflictPayload} />
    </main>
  );
}
