import { APP_NAME } from "@fe-radar/shared";

export function workerName(): string {
  return `${APP_NAME}-worker`;
}
