import { SourceFetchError } from "@fe-radar/shared";

/** 公告 API 403/429 耗尽适配器内重试后降级为空结果，避免 BullMQ job 级重试风暴。 */
export function isRateLimitFetchError(error: unknown): boolean {
  return (
    error instanceof SourceFetchError &&
    (error.code === "FETCH_429" || error.code === "FETCH_403")
  );
}
