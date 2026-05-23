import { getDatabase } from "../../lib/db";
import { insertIfNotTombstoned } from "./events-repo";
import type { MetricEvent, EventType } from "./types";

interface MetricsEventRow {
  id: string;
  timestamp: string;
  local_date: string;
  tz_offset_min: number;
  device_id: string;
  event_type: string;
  work_id: string | null;
  payload: string;
  schema_version: number;
}

interface TombstoneRow {
  id: string;
  deleted_at: string;
  device_id: string;
  reason: string;
}

export interface MetricsSyncBlob {
  events: MetricEvent[];
  tombstones: TombstoneRow[];
  updatedAt: number;
}

export async function serializeMetricsBatch(): Promise<string> {
  const db = await getDatabase();

  const eventRows = await db.select<MetricsEventRow[]>(
    `SELECT id, timestamp, local_date, tz_offset_min, device_id, event_type, work_id, payload, schema_version
    FROM metrics_events
    ORDER BY timestamp ASC, id ASC`,
  );

  const tombstoneRows = await db.select<TombstoneRow[]>(
    `SELECT id, deleted_at, device_id, reason
    FROM metrics_event_tombstones
    ORDER BY deleted_at ASC, id ASC`,
  );

  const events: MetricEvent[] = eventRows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    localDate: row.local_date,
    tzOffsetMin: row.tz_offset_min,
    deviceId: row.device_id,
    eventType: row.event_type as EventType,
    workId: row.work_id,
    payload: JSON.parse(row.payload),
    schemaVersion: row.schema_version,
  }));

  const maxTimestamp =
    eventRows.length > 0
      ? Math.max(
        ...eventRows.map((row) => new Date(row.timestamp).getTime()),
      )
      : 0;

  const blob: MetricsSyncBlob = {
    events,
    tombstones: tombstoneRows,
    updatedAt: Math.floor(
      Math.max(maxTimestamp, Date.now()) / 1000,
    ),
  };

  return JSON.stringify(blob);
}

export async function applyMetricsBatch(
  snapshot: MetricsSyncBlob,
): Promise<void> {
  const db = await getDatabase();

  for (const tombstone of snapshot.tombstones) {
    await db.execute(
      `INSERT OR IGNORE INTO metrics_event_tombstones
       (id, deleted_at, device_id, reason)
       VALUES (?, ?, ?, ?)`,
      [tombstone.id, tombstone.deleted_at, tombstone.device_id, tombstone.reason],
    );

    await db.execute("DELETE FROM metrics_events WHERE id = ?", [tombstone.id]);
  }

  for (const event of snapshot.events) {
    await insertIfNotTombstoned(db, event);
  }
}
