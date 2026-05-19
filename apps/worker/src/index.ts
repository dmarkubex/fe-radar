import { APP_NAME } from "@fe-radar/shared";

export function workerName(): string {
  return `${APP_NAME}-worker`;
}

export * from "./lib/proxy-pool";
export * from "./lib/robots";
export * from "./lib/ua-pool";
export { startWorker } from "./runner";

if (process.argv[1]?.endsWith("worker/src/index.ts") || process.argv[1]?.endsWith("worker/dist/index.js")) {
  import("./runner").then(({ startWorker }) => startWorker()).catch((error) => {
    console.error("worker startup failed:", error);
    process.exit(1);
  });
}
