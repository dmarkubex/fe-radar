import { workerLogger } from "./logger";
import { startWorker } from "./runner";

const log = workerLogger;

function exitWithSignal(signal: string): void {
  log.info({ signal }, "shutdown signal received");
  process.exit(0);
}

process.once("SIGTERM", () => exitWithSignal("SIGTERM"));
process.once("SIGINT", () => exitWithSignal("SIGINT"));

process.on("unhandledRejection", (reason: unknown) => {
  log.error({ reason }, "unhandledRejection");
  process.exit(1);
});

startWorker().catch((err: unknown) => {
  log.error({ err }, "fatal startup error");
  process.exit(1);
});
