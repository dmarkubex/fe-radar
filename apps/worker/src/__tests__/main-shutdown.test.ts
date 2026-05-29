import { afterEach, describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("main shutdown signal handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("../runner");
    vi.doUnmock("../logger");
  });

  it("waits for worker shutdown before exiting on SIGTERM", async () => {
    const shutdownDone = deferred<void>();
    const shutdown = vi.fn(() => shutdownDone.promise);
    const startWorker = vi.fn(() => Promise.resolve({ shutdown }));
    const handlers: Partial<Record<"SIGTERM" | "SIGINT", () => void>> = {};
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    vi.spyOn(process, "once").mockImplementation((event, listener) => {
      if (event === "SIGTERM" || event === "SIGINT") {
        handlers[event] = listener as () => void;
      }
      return process;
    });
    vi.spyOn(process, "on").mockImplementation(() => process);
    vi.doMock("../runner", () => ({ startWorker }));
    vi.doMock("../logger", () => ({
      workerLogger: {
        info: vi.fn(),
        error: vi.fn(),
      },
    }));

    await import("../main");
    expect(handlers.SIGTERM).toBeTypeOf("function");

    handlers.SIGTERM?.();
    await flushPromises();

    expect(shutdown).toHaveBeenCalledWith("SIGTERM");
    expect(exit).not.toHaveBeenCalled();

    shutdownDone.resolve();
    await flushPromises();

    expect(exit).toHaveBeenCalledWith(0);
  });
});
