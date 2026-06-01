"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

export function DingtalkButton(): React.JSX.Element {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  return (
    <Button type="button" variant="outline" onClick={() => void signIn("dingtalk", { callbackUrl })}>
      钉钉扫码登录
    </Button>
  );
}
