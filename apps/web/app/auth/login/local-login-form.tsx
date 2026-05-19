"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

export function LocalLoginForm(): React.JSX.Element {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const result = await signIn("credentials", {
      username: String(form.get("username") ?? ""),
      password: String(form.get("password") ?? ""),
      redirect: false
    });
    setPending(false);

    if (result?.error) {
      setError("用户名或密码错误");
      return;
    }

    window.location.href = searchParams.get("callbackUrl") || "/";
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] tracking-[1.4px] uppercase text-fg-muted">用户名</span>
        <input
          className="h-10 border border-border-strong bg-surface px-3 text-sm text-fg outline-none focus:border-accent"
          name="username"
          type="text"
          autoComplete="username"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] tracking-[1.4px] uppercase text-fg-muted">密码</span>
        <input
          className="h-10 border border-border-strong bg-surface px-3 text-sm text-fg outline-none focus:border-accent"
          name="password"
          type="password"
          autoComplete="current-password"
        />
      </label>
      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 border border-fg bg-fg px-[18px] py-[11px] text-[13px] tracking-[0.4px] text-fg-on-dark hover:bg-accent disabled:opacity-60"
      >
        {pending ? "登录中…" : "登录"}
      </button>
    </form>
  );
}
