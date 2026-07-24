"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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

type NewUserForm = {
  username: string;
  password: string;
  passwordConfirm: string;
  name: string;
  dept: string;
  role: "viewer" | "editor" | "admin";
};

const EMPTY_USER: NewUserForm = {
  username: "",
  password: "",
  passwordConfirm: "",
  name: "",
  dept: "",
  role: "viewer"
};
const PAGE_SIZE = 25;

async function responseError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return payload?.error?.message ?? fallback;
}

export function UsersAdmin({ users, mergeConflicts }: { users: UserRow[]; mergeConflicts: MergeConflictRow[] }): React.JSX.Element {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [newUserForm, setNewUserForm] = useState<NewUserForm>(EMPTY_USER);
  const [createPending, setCreatePending] = useState(false);
  const [rowPending, setRowPending] = useState<number | null>(null);
  const rowLocked = useRef(false);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [conflictPending, setConflictPending] = useState<number | null>(null);
  const conflictLocked = useRef(false);
  const [conflictErrors, setConflictErrors] = useState<Record<number, string>>({});
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) =>
      [user.name, user.username, user.dingtalkId, user.dept, user.role]
        .some((value) => value?.toLowerCase().includes(needle))
    );
  }, [query, users]);
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const activePage = Math.min(page, pageCount);
  const visibleUsers = filteredUsers.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE);

  async function createUser(): Promise<void> {
    setStatus("");
    if (newUserForm.password !== newUserForm.passwordConfirm) {
      setStatus("创建失败：两次输入的密码不一致");
      return;
    }
    const body = {
      username: newUserForm.username,
      password: newUserForm.password,
      name: newUserForm.name,
      dept: newUserForm.dept || undefined,
      role: newUserForm.role
    };
    setCreatePending(true);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        setStatus(`创建失败：${await responseError(response, "未知错误")}`);
        return;
      }
      setStatus("用户已创建");
      setNewUserForm(EMPTY_USER);
      router.refresh();
    } catch {
      setStatus("创建失败：请检查网络后重试");
    } finally {
      setCreatePending(false);
    }
  }

  async function updateUser(id: number, body: Record<string, unknown>): Promise<void> {
    if (rowLocked.current) return;
    rowLocked.current = true;
    setStatus("");
    setRowPending(id);
    setRowErrors((errors) => ({ ...errors, [id]: "" }));
    try {
      const response = await fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const message = await responseError(response, "保存失败");
        setRowErrors((errors) => ({ ...errors, [id]: message }));
        return;
      }
      setStatus("用户设置已保存");
      router.refresh();
    } catch {
      setRowErrors((errors) => ({ ...errors, [id]: "保存失败，请检查网络后重试" }));
    } finally {
      rowLocked.current = false;
      setRowPending(null);
    }
  }

  async function resolveConflict(id: number, body: Record<string, unknown>): Promise<void> {
    if (conflictLocked.current) return;
    conflictLocked.current = true;
    setStatus("");
    setConflictPending(id);
    setConflictErrors((errors) => ({ ...errors, [id]: "" }));
    try {
      const response = await fetch(`/api/users/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const message = await responseError(response, "处理失败");
        setConflictErrors((errors) => ({ ...errors, [id]: message }));
        return;
      }
      setStatus("合并冲突已处理");
      router.refresh();
    } catch {
      setConflictErrors((errors) => ({ ...errors, [id]: "处理失败，请检查网络后重试" }));
    } finally {
      conflictLocked.current = false;
      setConflictPending(null);
    }
  }

  return (
    <div className="grid gap-6">
      <p aria-live="polite" className="min-h-5 text-sm text-fg-soft">{status}</p>
      <section className="rounded-none border border-border bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">新增本地用户</h2>
        <form className="mt-4 grid gap-3 shell:grid-cols-4" onSubmit={(event) => { event.preventDefault(); void createUser(); }}>
          <input
            required
            className="h-10 rounded-none border border-border px-3"
            placeholder="用户名"
            type="text"
            value={newUserForm.username}
            onChange={(event) => setNewUserForm((form) => ({ ...form, username: event.target.value }))}
          />
          <input
            required
            className="h-10 rounded-none border border-border px-3"
            placeholder="密码"
            type="password"
            value={newUserForm.password}
            onChange={(event) => setNewUserForm((form) => ({ ...form, password: event.target.value }))}
          />
          <input
            required
            className="h-10 rounded-none border border-border px-3"
            placeholder="确认密码"
            type="password"
            value={newUserForm.passwordConfirm}
            onChange={(event) => setNewUserForm((form) => ({ ...form, passwordConfirm: event.target.value }))}
          />
          <input
            required
            className="h-10 rounded-none border border-border px-3"
            placeholder="姓名"
            type="text"
            value={newUserForm.name}
            onChange={(event) => setNewUserForm((form) => ({ ...form, name: event.target.value }))}
          />
          <input
            className="h-10 rounded-none border border-border px-3"
            placeholder="部门"
            type="text"
            value={newUserForm.dept}
            onChange={(event) => setNewUserForm((form) => ({ ...form, dept: event.target.value }))}
          />
          <select
            className="h-10 rounded-none border border-border px-3"
            value={newUserForm.role}
            onChange={(event) => setNewUserForm((form) => ({ ...form, role: event.target.value as NewUserForm["role"] }))}
          >
            <option value="viewer">viewer</option>
            <option value="editor">editor</option>
            <option value="admin">admin</option>
          </select>
          <Button disabled={createPending} type="submit">
            {createPending ? "创建中…" : "新增用户"}
          </Button>
        </form>
      </section>

      <section className="rounded-none border border-border bg-surface">
        <div className="flex flex-col gap-3 border-b border-border p-4 shell:flex-row shell:items-center shell:justify-between">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-fg-muted">
            <span className="shrink-0">搜索用户</span>
            <input
              className="h-10 min-w-0 flex-1 border border-border px-3 text-fg"
              placeholder="姓名、账号、部门或角色"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <span className="font-mono text-xs text-fg-soft">{filteredUsers.length} 位用户</span>
        </div>
        <div className="overflow-x-auto">
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
              {visibleUsers.map((user) => (
                <tr className="border-t border-hairline" key={user.id}>
                  <td className="p-3 font-medium text-fg">{user.name}</td>
                  <td className="p-3 text-fg-muted">{user.username ?? user.dingtalkId ?? "-"}</td>
                  <td className="p-3">
                    <select
                      className="h-10 rounded-none border border-border px-2"
                      disabled={rowPending !== null}
                      value={user.role}
                      onChange={(event) => void updateUser(user.id, { role: event.target.value })}
                    >
                      <option value="viewer">viewer</option>
                      <option value="editor">editor</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="p-3">{user.disabledAt ? "停用" : "启用"}</td>
                  <td className="p-3">
                    <Button
                      disabled={rowPending !== null}
                      size="sm"
                      variant="outline"
                      type="button"
                      onClick={() => void updateUser(user.id, { disabled: !user.disabledAt })}
                    >
                      {rowPending === user.id ? "保存中…" : user.disabledAt ? "恢复" : "停用"}
                    </Button>
                    {rowErrors[user.id] ? <p className="mt-1 max-w-64 text-xs text-danger" role="alert">{rowErrors[user.id]}</p> : null}
                  </td>
                </tr>
              ))}
              {visibleUsers.length === 0 ? (
                <tr><td className="p-6 text-center text-fg-soft" colSpan={5}>没有匹配的用户</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border p-3">
          <Button disabled={activePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} size="sm" type="button" variant="outline">上一页</Button>
          <span className="font-mono text-xs text-fg-soft">{activePage} / {pageCount}</span>
          <Button disabled={activePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} size="sm" type="button" variant="outline">下一页</Button>
        </div>
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
                  <Button disabled={conflictPending !== null} key={candidateId} size="sm" type="button" onClick={() => void resolveConflict(conflict.id, { action: "confirm", targetUserId: candidateId })}>
                    合并到 {candidateId}
                  </Button>
                ))}
                <Button disabled={conflictPending !== null} size="sm" variant="outline" type="button" onClick={() => void resolveConflict(conflict.id, { action: "reject" })}>拒绝</Button>
              </div>
              {conflictErrors[conflict.id] ? <p className="mt-2 text-xs text-danger" role="alert">{conflictErrors[conflict.id]}</p> : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
