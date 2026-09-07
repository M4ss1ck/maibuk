import type { DatabaseAdapter } from "@/lib/platform/types";
import {
  SQL_EXPORT_TABLES,
  assembleSqlDump,
  formatExportInsertStatements,
} from "@/lib/db/sql-export-format";
import type {
  SqlExportFinishMessage,
  SqlExportRequest,
  SqlExportResponse,
} from "@/lib/db/sql-export-format";

// Bounded page size for export reads. Rows are fetched sequentially with
// LIMIT/OFFSET and sent one page at a time, so at most one page is cloned
// in flight; the assembled dump string itself necessarily grows with the
// database.
const EXPORT_PAGE_SIZE = 100;

// Optional worker factory (used by tests to inject a fake). There are
// intentionally no other options.
export interface SqlExportOptions {
  createWorker?: () => Worker;
}

type SqlExportReader = Pick<DatabaseAdapter, "select">;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const ROW_ID_ALIAS = "__maibuk_export_rowid";

function pagedSelect(table: string, afterRowId: number): { sql: string; params: unknown[] } {
  return {
    sql: `SELECT *, rowid AS "${ROW_ID_ALIAS}" FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ?`,
    params: [afterRowId, EXPORT_PAGE_SIZE],
  };
}

async function readTablePages(
  adapter: SqlExportReader,
  table: string,
  onPage: (rows: Record<string, unknown>[]) => Promise<void> | void,
): Promise<void> {
  let afterRowId = 0;
  for (;;) {
    const { sql, params } = pagedSelect(table, afterRowId);
    const page = await adapter.select<Record<string, unknown>[]>(sql, params);
    const rows = page.map((row) => {
      const { [ROW_ID_ALIAS]: _rowId, ...exportedRow } = row;
      return exportedRow;
    });
    if (rows.length > 0) {
      await onPage(rows);
    }
    if (rows.length < EXPORT_PAGE_SIZE) break;
    // Yield between pages so large exports don't block the main thread
    // while the worker formats the previous page.
    await yieldToEventLoop();
    const nextRowId = page[page.length - 1]?.[ROW_ID_ALIAS];
    if (typeof nextRowId !== "number") {
      throw new Error(`SQL export returned an invalid rowid for ${table}`);
    }
    afterRowId = nextRowId;
  }
}

// Fallback when the Worker API is unavailable.
async function exportViaFallback(
  adapter: SqlExportReader,
  exportedAt: string,
): Promise<Uint8Array> {
  const sections = new Map<string, string>();
  for (const table of SQL_EXPORT_TABLES) {
    const chunks: string[] = [];
    await readTablePages(adapter, table.name, (rows) => {
      chunks.push(formatExportInsertStatements(table.name, rows));
    });
    sections.set(table.name, chunks.join("\n"));
  }
  return new TextEncoder().encode(assembleSqlDump(exportedAt, sections));
}

type PendingAck = {
  kind: "ack";
  resolve: () => void;
  reject: (error: Error) => void;
};

type PendingResult = {
  kind: "result";
  resolve: (buffer: ArrayBuffer) => void;
  reject: (error: Error) => void;
};

// Worker path: rows are read on the main thread in bounded pages while the
// worker owns SQL formatting and final encoding. Each send awaits its
// acknowledgement, so only one page is ever in flight.
async function exportViaWorker(
  adapter: SqlExportReader,
  exportedAt: string,
  createWorker: () => Worker,
): Promise<Uint8Array> {
  let worker: Worker | null = null;
  try {
    worker = createWorker();
    const active = worker;

    let pending: PendingAck | PendingResult | null = null;
    // Latched on the first fatal worker failure, including failures that
    // arrive while no request is pending (e.g. during a page read). The
    // next request rejects immediately instead of waiting forever.
    let workerFailed: Error | null = null;
    const fail = (error: Error): void => {
      if (!workerFailed) workerFailed = error;
      const current = pending;
      pending = null;
      current?.reject(error);
    };

    active.onmessage = (event: MessageEvent) => {
      const message = event.data as SqlExportResponse;
      const current = pending;
      if (!current) return;
      if (current.kind === "ack" && message?.type === "ack") {
        pending = null;
        current.resolve();
      } else if (current.kind === "result" && message?.type === "result") {
        pending = null;
        current.resolve(message.buffer);
      } else {
        pending = null;
        current.reject(new Error("Unexpected message from sql-export worker"));
      }
    };
    // Worker failures must reject so a safety backup fails loudly instead
    // of hanging with no acknowledgement.
    active.onerror = (event: Event | string) => {
      const detail = typeof event === "string" ? event : "worker error";
      fail(new Error(`sql-export worker failed: ${detail}`));
    };
    active.onmessageerror = () => {
      fail(new Error("sql-export worker message failed to deserialize"));
    };

    const throwIfFailed = (): void => {
      if (workerFailed) throw workerFailed;
    };

    const requestAck = (message: SqlExportRequest): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        if (workerFailed) {
          reject(workerFailed);
          return;
        }
        pending = { kind: "ack", resolve, reject };
        try {
          active.postMessage(message);
        } catch (error) {
          pending = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });

    const requestResult = (): Promise<ArrayBuffer> =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        if (workerFailed) {
          reject(workerFailed);
          return;
        }
        pending = { kind: "result", resolve, reject };
        try {
          active.postMessage({ type: "finish" } satisfies SqlExportFinishMessage);
        } catch (error) {
          pending = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });

    await requestAck({ type: "init", exportedAt });
    for (const table of SQL_EXPORT_TABLES) {
      await readTablePages(adapter, table.name, (rows) => {
        throwIfFailed();
        return requestAck({ type: "page", table: table.name, rows });
      });
    }
    const buffer = await requestResult();
    return new Uint8Array(buffer);
  } finally {
    worker?.terminate();
  }
}

function defaultCreateWorker(): (() => Worker) | undefined {
  if (typeof Worker === "undefined") return undefined;
  return () => new Worker(new URL("./sql-export.worker.ts", import.meta.url), { type: "module" });
}

export async function exportSqlDump(
  adapter: SqlExportReader,
  options?: SqlExportOptions,
): Promise<Uint8Array> {
  const exportedAt = new Date().toISOString();
  const createWorker = options?.createWorker ?? defaultCreateWorker();
  // Fallback applies only when the Worker API itself is unavailable. A
  // created worker that later errors rejects instead of falling back.
  if (!createWorker) return exportViaFallback(adapter, exportedAt);
  return exportViaWorker(adapter, exportedAt, createWorker);
}
