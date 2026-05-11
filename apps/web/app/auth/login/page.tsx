import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DingtalkButton } from "@/components/auth/dingtalk-button";
import { isDingtalkEnabled } from "@/lib/auth/dingtalk-provider";

export default function LoginPage(): React.JSX.Element {
  const dingtalkEnabled = isDingtalkEnabled();
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>登录 FE-Radar</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" action="/api/auth/callback/credentials" method="post">
            <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
              用户名
              <input className="h-10 rounded-md border border-zinc-200 px-3" name="username" type="text" autoComplete="username" />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-zinc-700">
              密码
              <input className="h-10 rounded-md border border-zinc-200 px-3" name="password" type="password" autoComplete="current-password" />
            </label>
            <Button type="submit">登录</Button>
          </form>
          {dingtalkEnabled ? (
            <div className="mt-4 border-t border-zinc-200 pt-4">
              <DingtalkButton />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
