import { startWorker, createWorkerRuntime } from "./bootstrap";
import type { WorkerRuntime } from "./bootstrap";
import { handleFetchJob } from "./handlers/fetch";

export type { WorkerRuntime };
export { startWorker };
export { workerName } from "./index";
export const __testables = { handleFetchJob, createWorkerRuntime };
