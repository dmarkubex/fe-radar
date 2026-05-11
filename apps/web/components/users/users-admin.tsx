"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface UserRow {
  id: number;
  username: string | null;
  dingtalkId: string | null;
  name: string;
  dept: string | null;
  role: string;
  disabledAt: string | null;
}

interface MergeConflictRow {
  id: number;
  unionid: string;
  name: string;
  dept: string | null;
  candidateIds: number[];
}

export function UsersAdmin({ users, mergeConflicts }: { users: UserRow[]; mergeConflicts: MergeConflictRow[] }): React.JSX.Element {
  const [status, setStatus] = useState("");

  async function updateUser(id: number, body: Record<string, unknown>): Promise<void> {
    const response = await fetch(`/api/users/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    setStatus(response.ok ? "已保存，请刷新查看" : "保存失败");
  }

  async function resolveConflict(id: number, body: Record<string, unknown>): Promise<void> {
    const response = await fetch(`/api/users/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    setStatus(response.ok ? "合并冲突已处理，请刷新查看" : "处理失败");
  }

  return (
    <div className="grid gap-6">
      <p className="text-sm text-zinc-500">{status}</p>
      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-500">
            <tr>
              <th className="p-3">姓名</th>
              <th className="p-3">账号</th>
              <th className="p-3">角色</th>
              <th className="p-3">状态</th>
              <th className="p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr className="border-t border-zinc-100" key={user.id}>
                <td className="p-3 font-medium text-zinc-950">{user.name}</td>
                <td className="p-3 text-zinc-600">{user.username ?? user.dingtalkId ?? "-"}</td>
                <td className="p-3">
                  <select className="rounded-md border border-zinc-200 px-2 py-1" value={user.role} onChange={(event) => void updateUser(user.id, { role: event.target.value })}>
                    <option value="viewer">viewer</option>
                    <option value="editor">editor</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="p-3">{user.disabledAt ? "停用" : "启用"}</td>
                <td className="p-3">
                  <Button size="sm" variant="outline" type="button" onClick={() => void updateUser(user.id, { disabled: !user.disabledAt })}>
                    {user.disabledAt ? "恢复" : "停用"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-base font-semibold text-zinc-950">待处理合并冲突</h2>
        <div className="mt-4 grid gap-3">
          {mergeConflicts.length === 0 ? <p className="text-sm text-zinc-500">暂无冲突</p> : null}
          {mergeConflicts.map((conflict) => (
            <div className="rounded-md border border-zinc-200 p-3" key={conflict.id}>
              <p className="text-sm font-medium text-zinc-950">{conflict.name} · {conflict.dept ?? "-"}</p>
              <p className="mt-1 text-xs text-zinc-500">候选用户：{conflict.candidateIds.join(", ")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {conflict.candidateIds.map((candidateId) => (
                  <Button key={candidateId} size="sm" type="button" onClick={() => void resolveConflict(conflict.id, { action: "confirm", targetUserId: candidateId })}>
                    合并到 {candidateId}
                  </Button>
                ))}
                <Button size="sm" variant="outline" type="button" onClick={() => void resolveConflict(conflict.id, { action: "reject" })}>拒绝</Button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
