import { APP_NAME } from "@fe-radar/shared";

export function workerName(): string {
  return `${APP_NAME}-worker`;
}

export * from "./lib/proxy-pool";
export * from "./lib/robots";
export * from "./lib/ua-pool";
