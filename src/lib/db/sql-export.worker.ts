import {
  SQL_EXPORT_TABLES,
  assembleSqlDump,
  formatExportInsertStatements,
} from "@/lib/db/sql-export-format";
import type { SqlExportRequest, SqlExportResponse } from "@/lib/db/sql-export-format";

// Dedicated module worker: owns SQL string assembly and final TextEncoder
// output. Pages arrive via postMessage from the main thread, which keeps
// the sole DatabaseAdapter and reads in bounded pages.
const scope = self as unknown as {
  postMessage(message: SqlExportResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<SqlExportRequest>) => void) | null;
};

let exportedAt = "";
let chunksByTable = new Map<string, string[]>();

function reset(exportedAtValue: string): void {
  exportedAt = exportedAtValue;
  chunksByTable = new Map(SQL_EXPORT_TABLES.map((table) => [table.name, []]));
}

function ack(): void {
  scope.postMessage({ type: "ack" });
}

reset("");

scope.onmessage = (event: MessageEvent<SqlExportRequest>) => {
  const message = event.data;

  if (message.type === "init") {
    reset(message.exportedAt);
    ack();
    return;
  }

  if (message.type === "page") {
    let chunks = chunksByTable.get(message.table);
    if (!chunks) {
      chunks = [];
      chunksByTable.set(message.table, chunks);
    }
    if (message.rows.length > 0) {
      chunks.push(formatExportInsertStatements(message.table, message.rows));
    }
    ack();
    return;
  }

  if (message.type === "finish") {
    const sections = new Map<string, string>();
    for (const [name, chunks] of chunksByTable) {
      sections.set(name, chunks.join("\n"));
    }
    const encoded = new TextEncoder().encode(assembleSqlDump(exportedAt, sections));
    const buffer = encoded.buffer as ArrayBuffer;
    scope.postMessage({ type: "result", buffer }, [buffer]);
  }
};
