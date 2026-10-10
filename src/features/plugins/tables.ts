/**
 * The Plugin tables in the Library (ADR 0023). Plugin storage is Library data:
 * Backups and Database Files carry it, Restore replaces it, and Reset Library
 * clears it. This is the one list the export, the Restore and Reset delete
 * lists, and the table-coverage agreement test share, so a new Plugin table
 * cannot join one path and be missed by another (the Canvas-wipe class of
 * bug).
 */

/** One JSON value per Plugin id and storage key. */
export const PLUGIN_STORAGE_TABLE = "plugin_storage";

/** The dataVersion of the manifest that last wrote each Plugin's namespace. */
export const PLUGIN_DATA_VERSIONS_TABLE = "plugin_data_versions";

export const PLUGIN_TABLES = [PLUGIN_STORAGE_TABLE, PLUGIN_DATA_VERSIONS_TABLE] as const;
