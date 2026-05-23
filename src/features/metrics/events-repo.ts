import type { DatabaseAdapter } from "../../lib/platform/types";
import type { MetricEvent, MetricsCacheEntry } from "./types";

interface MetricEventRow {
  id: string;
  timestamp: string;
  local_date: string;
  tz_offset_min: number;
  device_id: string;
  event_type: MetricEvent["eventType"];
  work_id: string | null;
  payload: string;
  schema_version: number;
}

export async function ensureMetricsSchema(db: DatabaseAdapter): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS metrics_events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      local_date TEXT NOT NULL,
      tz_offset_min INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      work_id TEXT,
      payload TEXT NOT NULL,
      schema_version INTEGER NOT NULL
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_metrics_events_local_date
      ON metrics_events(local_date)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_metrics_events_type_date
      ON metrics_events(event_type, local_date)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_metrics_events_work
      ON metrics_events(work_id)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_metrics_events_timestamp
      ON metrics_events(timestamp)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS metrics_event_tombstones (
      id TEXT PRIMARY KEY,
      deleted_at TEXT NOT NULL,
      device_id TEXT NOT NULL,
      reason TEXT NOT NULL
    )
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_metrics_tombstones_deleted_at
      ON metrics_event_tombstones(deleted_at)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS metrics_cache (
      cache_key TEXT PRIMARY KEY,
      aggregate_version INTEGER NOT NULL,
      source_high_watermark TEXT NOT NULL,
      computed_at TEXT NOT NULL,
      payload TEXT NOT NULL
    )
  `);
}

export async function insertEvents(
  db: DatabaseAdapter,
  events: MetricEvent[],
): Promise<void> {
  for (const event of events) {
    await db.execute(
      `INSERT OR IGNORE INTO metrics_events
        (id, timestamp, local_date, tz_offset_min, device_id, event_type, work_id, payload, schema_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.timestamp,
        event.localDate,
        event.tzOffsetMin,
        event.deviceId,
        event.eventType,
        event.workId,
        JSON.stringify(event.payload),
        event.schemaVersion,
      ],
    );
  }
}

export async function insertIfNotTombstoned(
  db: DatabaseAdapter,
  event: MetricEvent,
): Promise<boolean> {
  const tombstones = await db.select<{ id: string }[]>(
    "SELECT id FROM metrics_event_tombstones WHERE id = ? LIMIT 1",
    [event.id],
  );
  if (tombstones.length > 0) return false;
  await insertEvents(db, [event]);
  return true;
}

export async function listEvents(db: DatabaseAdapter): Promise<MetricEvent[]> {
  const rows = await db.select<MetricEventRow[]>(
    `SELECT id, timestamp, local_date, tz_offset_min, device_id, event_type, work_id, payload, schema_version
     FROM metrics_events
     ORDER BY timestamp ASC, id ASC`,
  );
  return rows.map(toMetricEvent);
}

export async function purgeEventsByPrefix(
  db: DatabaseAdapter,
  eventTypePrefix: string,
  deviceId: string,
  deletedAt: string,
): Promise<number> {
  const pattern = `${eventTypePrefix}%`;
  const rows = await db.select<{ id: string }[]>(
    "SELECT id FROM metrics_events WHERE event_type LIKE ?",
    [pattern],
  );

  for (const row of rows) {
    await db.execute(
      `INSERT OR IGNORE INTO metrics_event_tombstones
        (id, deleted_at, device_id, reason)
       VALUES (?, ?, ?, ?)`,
      [row.id, deletedAt, deviceId, "category-opt-out"],
    );
  }

  await db.execute("DELETE FROM metrics_events WHERE event_type LIKE ?", [pattern]);
  return rows.length;
}

export async function upsertCache(
  db: DatabaseAdapter,
  entry: MetricsCacheEntry,
): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO metrics_cache
      (cache_key, aggregate_version, source_high_watermark, computed_at, payload)
     VALUES (?, ?, ?, ?, ?)`,
    [
      entry.cacheKey,
      entry.aggregateVersion,
      entry.sourceHighWatermark,
      entry.computedAt,
      JSON.stringify(entry.payload),
    ],
  );
}

export async function invalidateCache(
  db: DatabaseAdapter,
  prefixes: string[],
): Promise<void> {
  for (const prefix of prefixes) {
    await db.execute("DELETE FROM metrics_cache WHERE cache_key LIKE ?", [`${prefix}%`]);
  }
}

function toMetricEvent(row: MetricEventRow): MetricEvent {
  return {
    id: row.id,
    timestamp: row.timestamp,
    localDate: row.local_date,
    tzOffsetMin: row.tz_offset_min,
    deviceId: row.device_id,
    eventType: row.event_type,
    workId: row.work_id,
    payload: JSON.parse(row.payload),
    schemaVersion: row.schema_version,
  };
}
