import type { DbRequest, DbRequestPayload, DbResponse } from "@/lib/db/worker-protocol";
import { rebuildDbError } from "@/lib/db/worker-protocol";

/**
 * The page's end of the Library Worker protocol: one request in flight per id,
 * failures rebuilt as real Errors, and a latched failure so nothing waits
 * forever after a Worker crash.
 */
export interface DbWorkerTransport {
  request<T>(payload: DbRequestPayload): Promise<T>;
  terminate(): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class WorkerTransport implements DbWorkerTransport {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private worker: Worker | null = null;
  private failure: Error | null = null;

  constructor(private readonly createWorker: () => Worker) {}

  request<T>(payload: DbRequestPayload): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.failure) {
        reject(this.failure);
        return;
      }
      let worker: Worker;
      try {
        worker = this.attachWorker();
      } catch (error) {
        reject(asError(error));
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      const message: DbRequest = { ...payload, id };
      try {
        // Request bytes are cloned, not transferred: a failed migration needs
        // the same legacy bytes again to open them in memory.
        worker.postMessage(message);
      } catch (error) {
        this.pending.delete(id);
        reject(asError(error));
      }
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.fail(new Error("The Library Worker was closed"));
  }

  private attachWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event: MessageEvent<DbResponse>) => {
      const message = event.data;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) {
        pending.resolve(message.value);
      } else {
        pending.reject(rebuildDbError(message.error));
      }
    };
    // A dead Worker must reject every waiting request instead of hanging.
    worker.onerror = (event) => {
      this.fail(new Error(`The Library Worker failed: ${event.message || "unknown error"}`));
    };
    worker.onmessageerror = () => {
      this.fail(new Error("The Library Worker message failed to deserialize"));
    };
    this.worker = worker;
    return worker;
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

/** The browser Worker that owns the Library (ADR 0035). */
export function createDbWorkerTransport(): WorkerTransport {
  return new WorkerTransport(
    () => new Worker(new URL("./db-worker.ts", import.meta.url), { type: "module" })
  );
}
