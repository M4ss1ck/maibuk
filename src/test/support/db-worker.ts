import type { DbWorkerHandler } from "@/lib/db/db-worker-handler";
import type { DbRequestPayload } from "@/lib/db/worker-protocol";
import { rebuildDbError } from "@/lib/db/worker-protocol";
import { WebDatabaseAdapter } from "@/lib/platform/web/database";
import type { DbWorkerTransport } from "@/lib/platform/web/db-client";

/**
 * Drives the Worker's message handler in-process, so a test gets the real
 * protocol behaviour (including error serialization) without a browser
 * Worker. `DBS`-shaped calls never leave the test thread.
 */
export function createInProcessTransport(handler: DbWorkerHandler): DbWorkerTransport {
  let nextId = 1;
  return {
    async request<T>(payload: DbRequestPayload): Promise<T> {
      const { response } = await handler.handle({ ...payload, id: nextId++ });
      if (!response.ok) throw rebuildDbError(response.error);
      return response.value as T;
    },
    terminate() {},
  };
}

/** A web adapter wired to the real handler, as the browser would be. */
export function createTestWebDatabase(handler: DbWorkerHandler): WebDatabaseAdapter {
  return new WebDatabaseAdapter(createInProcessTransport(handler));
}
