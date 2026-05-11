import { Button } from "@/components/ui/button";

export function DingtalkButton(): React.JSX.Element {
  return (
    <Button asChild variant="outline">
      <a href="/api/auth/signin/dingtalk">钉钉扫码登录</a>
    </Button>
  );
}
