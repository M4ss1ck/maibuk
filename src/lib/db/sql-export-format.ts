// Pure SQL dump formatting shared by the export worker and the fallback
// path, so both emit identical output for the same rows. Dependency-free:
// the worker bundle imports this module without pulling in client code.
export interface SqlExportTable {
  name: string;
  comment: string;
}

// Fixed table set and order: the dump format must stay stable so backups
// restore across versions.
export const SQL_EXPORT_TABLES: SqlExportTable[] = [
  { name: "books", comment: "-- Books" },
  { name: "chapters", comment: "-- Chapters" },
  { name: "book_versions", comment: "-- Book Versions" },
  { name: "notes", comment: "-- Notes" },
  { name: "sync_tombstones", comment: "-- Sync Tombstones" },
  { name: "cover_templates", comment: "-- Cover Templates" },
  { name: "settings", comment: "-- Settings" },
];

export function escapeSqlExportValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function formatExportInsertStatements(
  tableName: string,
  rows: Record<string, unknown>[],
): string {
  if (rows.length === 0) return "";

  const statements: string[] = [];
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = columns.map((col) => escapeSqlExportValue(row[col]));
    statements.push(
      `INSERT OR REPLACE INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${values.join(", ")});`,
    );
  }
  return statements.join("\n");
}

// Assembles the final dump text with the exact legacy header format and
// blank-line layout.
export function assembleSqlDump(
  exportedAt: string,
  sections: Map<string, string> | Record<string, string>,
): string {
  const getSection = (name: string): string =>
    sections instanceof Map ? (sections.get(name) ?? "") : (sections[name] ?? "");
  const lines: string[] = [
    "-- Maibuk Database Export (SQL Dump)",
    `-- Exported at: ${exportedAt}`,
    "-- Import this file into a SQLite database after creating the schema",
    "",
  ];
  SQL_EXPORT_TABLES.forEach((table, index) => {
    lines.push(table.comment, getSection(table.name));
    if (index < SQL_EXPORT_TABLES.length - 1) lines.push("");
  });
  return lines.join("\n");
}

export type SqlExportInitMessage = { type: "init"; exportedAt: string };
export type SqlExportPageMessage = {
  type: "page";
  table: string;
  rows: Record<string, unknown>[];
};
export type SqlExportFinishMessage = { type: "finish" };
export type SqlExportRequest = SqlExportInitMessage | SqlExportPageMessage | SqlExportFinishMessage;

export type SqlExportAckResponse = { type: "ack" };
export type SqlExportResultResponse = { type: "result"; buffer: ArrayBuffer };
export type SqlExportResponse = SqlExportAckResponse | SqlExportResultResponse;
