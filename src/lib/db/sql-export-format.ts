// Pure SQL dump formatting shared by the export worker and the fallback
// path, so both emit identical output for the same rows. It imports only
// the Plugin table-name constants, so the worker bundle stays free of
// client code.
import { PLUGIN_DATA_VERSIONS_TABLE, PLUGIN_STORAGE_TABLE } from "@/features/plugins/tables";

export interface SqlExportTable {
  name: string;
  comment: string;
}

// Dumps made before canvases joined the export (v0.4.14 through v0.7.1) have no
// section with this title; restore uses that to keep the device's Canvases.
export const CANVASES_SECTION_TITLE = "Canvases";

// Dumps made before Plugin storage joined the export have no section with one
// of these titles; restore uses that to keep the device's Plugin data.
const PLUGIN_STORAGE_SECTION_TITLE = "Plugin Storage";
const PLUGIN_DATA_VERSIONS_SECTION_TITLE = "Plugin Data Versions";
export const PLUGIN_SECTION_TITLES: readonly string[] = [
  PLUGIN_STORAGE_SECTION_TITLE,
  PLUGIN_DATA_VERSIONS_SECTION_TITLE,
];

// Fixed table set and order: the dump format must stay stable so backups
// restore across versions. Plugin tables are appended last so the sections an
// older app wrote keep their exact layout.
export const SQL_EXPORT_TABLES: SqlExportTable[] = [
  { name: "books", comment: "-- Books" },
  { name: "chapters", comment: "-- Chapters" },
  { name: "book_versions", comment: "-- Book Versions" },
  { name: "notes", comment: "-- Notes" },
  { name: "canvases", comment: `-- ${CANVASES_SECTION_TITLE}` },
  { name: "sync_tombstones", comment: "-- Sync Tombstones" },
  { name: "cover_templates", comment: "-- Cover Templates" },
  { name: "settings", comment: "-- Settings" },
  { name: PLUGIN_STORAGE_TABLE, comment: `-- ${PLUGIN_STORAGE_SECTION_TITLE}` },
  {
    name: PLUGIN_DATA_VERSIONS_TABLE,
    comment: `-- ${PLUGIN_DATA_VERSIONS_SECTION_TITLE}`,
  },
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
  rows: Record<string, unknown>[]
): string {
  if (rows.length === 0) return "";

  const statements: string[] = [];
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = columns.map((col) => escapeSqlExportValue(row[col]));
    statements.push(
      `INSERT OR REPLACE INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${values.join(", ")});`
    );
  }
  return statements.join("\n");
}

// Assembles the final dump text with the exact legacy header format and
// blank-line layout.
export function assembleSqlDump(
  exportedAt: string,
  sections: Map<string, string> | Record<string, string>
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
