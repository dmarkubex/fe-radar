import { forbidden } from "next/navigation";
import { auth } from "@/auth";
import { PageFrame } from "@/components/layout/page-frame";
import { PageHeader } from "@/components/layout/page-header";
import { evaluateCopilotAccess } from "@/lib/api/copilot-access";
import { webLogger } from "@/lib/logger";
import { AskChat } from "./ask-chat";

export const dynamic = "force-dynamic";

/**
 * /ask 问答页（Server Component）：灰度不过直接 forbidden()，
 * 不先渲染再画 403（authInterrupts 已在 next.config）。
 */
export default async function AskPage(): Promise<React.JSX.Element> {
  const session = await auth();
  const userId = Number(session?.user?.id);
  if (!session?.user?.id || !Number.isInteger(userId) || userId <= 0) {
    forbidden();
  }

  let enabled = false;
  try {
    enabled = await evaluateCopilotAccess(userId);
  } catch (err) {
    // 灰度判定抛错一律视为未通过（fail-closed）
    webLogger.error({ err }, "evaluateCopilotAccess failed");
    enabled = false;
  }
  if (!enabled) {
    forbidden();
  }

  return (
    <PageFrame>
      <PageHeader eyebrow="问时间线" title="问答" variant="compact" />
      <AskChat />
    </PageFrame>
  );
}
