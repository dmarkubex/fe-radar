import { workerLogger } from "./logger";
import { startWorker } from "./runner";
import type { WorkerRuntime } from "./runner";

const log = workerLogger;

type ShutdownSignal = "SIGTERM" | "SIGINT";
type ExitFn = (code: number) => void;
type SignalInstaller = (signal: ShutdownSignal, listener: () => void) => void;

interface ShutdownController {
  isShuttingDown(): boolean;
}

interface SignalHandlersOptions {
  workerStartup: Promise<WorkerRuntime>;
  log: Pick<typeof workerLogger, "info" | "error">;
  exit?: ExitFn;
  once?: SignalInstaller;
}

export function installSignalHandlers(options: SignalHandlersOptions): ShutdownController {
  const exit = options.exit ?? ((code: number) => {
    process.exit(code);
  });
  const once = options.once ?? ((signal: ShutdownSignal, listener: () => void) => {
    process.once(signal, listener);
  });
  let shutdownStarted = false;
  let shutdownPromise: Promise<void> | null = null;

  const shutdown = (signal: ShutdownSignal): Promise<void> => {
    shutdownStarted = true;
    shutdownPromise ??= (async () => {
      options.log.info({ signal }, "shutdown signal received");
      const runtime = await options.workerStartup;
      await runtime.shutdown(signal);
      exit(0);
    })().catch((err: unknown) => {
      options.log.error({ err, signal }, "graceful shutdown failed");
      exit(1);
    });

    return shutdownPromise;
  };

  once("SIGTERM", () => void shutdown("SIGTERM"));
  once("SIGINT", () => void shutdown("SIGINT"));

  return {
    isShuttingDown(): boolean {
      return shutdownStarted;
    },
  };
}

const workerStartup = startWorker();
const shutdownController = installSignalHandlers({ workerStartup, log });

process.on("unhandledRejection", (reason: unknown) => {
  log.error({ reason }, "unhandledRejection");
  process.exit(1);
});

workerStartup.catch((err: unknown) => {
  if (shutdownController.isShuttingDown()) {
    return;
  }
  log.error({ err }, "fatal startup error");
  process.exit(1);
});
