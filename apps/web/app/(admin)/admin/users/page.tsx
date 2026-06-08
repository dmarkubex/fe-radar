import { getDb, mergeConflicts, users } from "@fe-radar/db";
import { desc, eq } from "drizzle-orm";
import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";
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
    <PageFrame size="full">
      <PageHeader eyebrow="后台" title="用户管理" />
      <UsersAdmin users={userRows.map((item) => ({ ...item, disabledAt: item.disabledAt?.toISOString() ?? null }))} mergeConflicts={mergeConflictPayload} />
    </PageFrame>
  );
}
