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
  const [newUserForm, setNewUserForm] = useState({ username: "", password: "", name: "", dept: "", role: "viewer" as "viewer" | "editor" | "admin" });

  async function createUser(): Promise<void> {
    const body: Record<string, unknown> = { ...newUserForm };
    if (!body.dept) delete body.dept;
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (response.ok) {
      setStatus("用户已创建，请刷新查看");
      setNewUserForm({ username: "", password: "", name: "", dept: "", role: "viewer" });
    } else {
      const data = await response.json() as { error?: { message?: string } };
      setStatus(`创建失败：${data.error?.message ?? "未知错误"}`);
    }
  }

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
      <p className="text-sm text-fg-soft">{status}</p>
      <section className="rounded-none border border-border bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">新增本地用户</h2>
        <form className="mt-4 grid gap-3 md:grid-cols-6" onSubmit={(event) => { event.preventDefault(); void createUser(); }}>
          <input
            required
            className="rounded-none border border-border px-2 py-1"
            placeholder="用户名"
            type="text"
            value={newUserForm.username}
            onChange={(event) => setNewUserForm((form) => ({ ...form, username: event.target.value }))}
          />
          <input
            required
            className="rounded-none border border-border px-2 py-1"
            placeholder="密码"
            type="password"
            value={newUserForm.password}
            onChange={(event) => setNewUserForm((form) => ({ ...form, password: event.target.value }))}
          />
          <input
            required
            className="rounded-none border border-border px-2 py-1"
            placeholder="姓名"
            type="text"
            value={newUserForm.name}
            onChange={(event) => setNewUserForm((form) => ({ ...form, name: event.target.value }))}
          />
          <input
            className="rounded-none border border-border px-2 py-1"
            placeholder="部门"
            type="text"
            value={newUserForm.dept}
            onChange={(event) => setNewUserForm((form) => ({ ...form, dept: event.target.value }))}
          />
          <select
            className="rounded-none border border-border px-2 py-1"
            value={newUserForm.role}
            onChange={(event) => setNewUserForm((form) => ({ ...form, role: event.target.value as "viewer" | "editor" | "admin" }))}
          >
            <option value="viewer">viewer</option>
            <option value="editor">editor</option>
            <option value="admin">admin</option>
          </select>
          <Button type="submit">新增用户</Button>
        </form>
      </section>

      <section className="overflow-hidden rounded-none border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-bg text-left text-fg-soft">
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
              <tr className="border-t border-hairline" key={user.id}>
                <td className="p-3 font-medium text-fg">{user.name}</td>
                <td className="p-3 text-fg-muted">{user.username ?? user.dingtalkId ?? "-"}</td>
                <td className="p-3">
                  <select className="rounded-none border border-border px-2 py-1" value={user.role} onChange={(event) => void updateUser(user.id, { role: event.target.value })}>
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

      <section className="rounded-none border border-border bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">待处理合并冲突</h2>
        <div className="mt-4 grid gap-3">
          {mergeConflicts.length === 0 ? <p className="text-sm text-fg-soft">暂无冲突</p> : null}
          {mergeConflicts.map((conflict) => (
            <div className="rounded-none border border-border p-3" key={conflict.id}>
              <p className="text-sm font-medium text-fg">{conflict.name} · {conflict.dept ?? "-"}</p>
              <p className="mt-1 text-xs text-fg-soft">候选用户：{conflict.candidateIds.join(", ")}</p>
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
