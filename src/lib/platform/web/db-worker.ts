import { createDbWorkerHandler } from "@/lib/db/db-worker-handler";
import type { DbRequest, DbResponse } from "@/lib/db/worker-protocol";

// The dedicated module Worker that owns the web Library (ADR 0035). It runs
// the SQLite project's own WASM build and, where OPFS is usable, the
// `opfs-sahpool` VFS. The page talks to it only through `worker-protocol.ts`.
const scope = self as unknown as {
  postMessage(message: DbResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<DbRequest>) => void) | null;
};

const handler = createDbWorkerHandler();

// Requests run one at a time, in arrival order. An atomic load is a single
// message, and this queue is why nothing can interleave with it.
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (event: MessageEvent<DbRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    const { response, transfer } = await handler.handle(request);
    scope.postMessage(response, transfer);
  });
};
