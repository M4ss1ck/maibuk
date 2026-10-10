/**
 * A Plugin's own namespace in the Library (ADR 0023). Values are JSON, keyed
 * by Plugin id and storage key; one row per Plugin records the dataVersion
 * that last wrote the namespace.
 *
 * This is Library data: Backups and Database Files carry it, Restore replaces
 * it, and Reset Library clears it. It is not a Synced Item, so no function
 * here emits a Change or schedules Sync.
 */

import { getDatabase } from "@/lib/db";
import { escapeSqlExportValue } from "@/lib/db/sql-export-format";
import { PLUGIN_DATA_VERSIONS_TABLE, PLUGIN_STORAGE_TABLE } from "@/features/plugins/tables";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Every storage key the Plugin's namespace holds, in stable order. */
export async function listPluginStorageKeys(pluginId: string): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.select<{ key: string }[]>(
    `SELECT "key" FROM "${PLUGIN_STORAGE_TABLE}" WHERE plugin_id = ? ORDER BY "key"`,
    [pluginId]
  );
  return rows.map((row) => row.key);
}

/** The stored value for one key, or undefined when the namespace has none. */
export async function getPluginStorageValue(pluginId: string, key: string): Promise<unknown> {
  const db = await getDatabase();
  const rows = await db.select<{ value: string }[]>(
    `SELECT "value" FROM "${PLUGIN_STORAGE_TABLE}" WHERE plugin_id = ? AND "key" = ?`,
    [pluginId, key]
  );
  if (rows.length === 0) return undefined;
  return JSON.parse(rows[0].value) as unknown;
}

/** Stores a JSON value, replacing the key's previous value in place. */
export async function setPluginStorageValue(
  pluginId: string,
  key: string,
  value: unknown
): Promise<void> {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("Plugin storage values must be JSON");
  }
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO "${PLUGIN_STORAGE_TABLE}" (plugin_id, "key", "value", updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(plugin_id, "key") DO UPDATE SET
       "value" = excluded."value",
       updated_at = excluded.updated_at`,
    [pluginId, key, encoded, nowSeconds()]
  );
}

/** Removes one key; a missing key is a no-op. */
export async function deletePluginStorageValue(pluginId: string, key: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `DELETE FROM "${PLUGIN_STORAGE_TABLE}" WHERE plugin_id = ? AND "key" = ?`,
    [pluginId, key]
  );
}

/** Erases a whole namespace, its dataVersion record included, in one transaction. */
export async function clearPluginStorage(pluginId: string): Promise<void> {
  const db = await getDatabase();
  const plugin = escapeSqlExportValue(pluginId);
  await db.executeAtomic([
    `DELETE FROM "${PLUGIN_STORAGE_TABLE}" WHERE plugin_id = ${plugin}`,
    `DELETE FROM "${PLUGIN_DATA_VERSIONS_TABLE}" WHERE plugin_id = ${plugin}`,
  ]);
}

/** The dataVersion of the manifest that last wrote the namespace, or null when it has none. */
export async function getPluginDataVersion(pluginId: string): Promise<number | null> {
  const db = await getDatabase();
  const rows = await db.select<{ data_version: number }[]>(
    `SELECT data_version FROM "${PLUGIN_DATA_VERSIONS_TABLE}" WHERE plugin_id = ?`,
    [pluginId]
  );
  return rows.length === 0 ? null : rows[0].data_version;
}

/** Records the dataVersion now writing the namespace, for the activation gate. */
export async function setPluginDataVersion(pluginId: string, dataVersion: number): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO "${PLUGIN_DATA_VERSIONS_TABLE}" (plugin_id, data_version, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(plugin_id) DO UPDATE SET
       data_version = excluded.data_version,
       updated_at = excluded.updated_at`,
    [pluginId, dataVersion, nowSeconds()]
  );
}

/**
 * The namespace's stored data size in UTF-8 bytes (Settings warns once at
 * 50 MB); the tiny dataVersion record is not counted.
 */
export async function getPluginDataSize(pluginId: string): Promise<number> {
  const db = await getDatabase();
  const rows = await db.select<{ bytes: number | null }[]>(
    `SELECT COALESCE(SUM(LENGTH(CAST("value" AS BLOB))), 0) AS bytes
     FROM "${PLUGIN_STORAGE_TABLE}" WHERE plugin_id = ?`,
    [pluginId]
  );
  return rows[0]?.bytes ?? 0;
}
