import type { DatabaseAdapter } from "../../lib/platform/types";
import type { AggregateKey, SnapshotMetrics } from "./aggregates/types";
import type {
  DailyAggregateMetricPayload,
  MetricEvent,
  MetricsCacheEntry,
  MetricsCategory,
} from "./types";

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

interface CacheRow {
  cache_key: string;
  aggregate_version: number;
  source_high_watermark: string;
  window_start: string | null;
  computed_at: string;
  payload: string;
}

interface SnapshotWorkRow {
  id: string;
  title: string;
  word_count: number | null;
}

const DAILY_AGGREGATE_BUCKET = "daily-v1";

/**
 * Max raw events folded into a single daily aggregate segment. Bounds the
 * encrypted `meta` payload (which inlines each segment's source event ids) so
 * it stays well under the sync server's per-field character limit and keeps
 * bulk pull responses lean. Days with more events split into several segments.
 */
export const MAX_SOURCE_EVENTS_PER_SEGMENT = 250;

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
      schema_version INTEGER NOT NULL,
      pushed_at TEXT
    )
  `);
  // Additive migration for installs that predate the pushed_at column.
  await db.execute("ALTER TABLE metrics_events ADD COLUMN pushed_at TEXT").catch(() => {});

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
      reason TEXT NOT NULL,
      pushed_at TEXT
    )
  `);
  await db
    .execute("ALTER TABLE metrics_event_tombstones ADD COLUMN pushed_at TEXT")
    .catch(() => {});
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_metrics_tombstones_deleted_at
      ON metrics_event_tombstones(deleted_at)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS metrics_cache (
      cache_key TEXT PRIMARY KEY,
      aggregate_version INTEGER NOT NULL,
      source_high_watermark TEXT NOT NULL,
      window_start TEXT,
      computed_at TEXT NOT NULL,
      payload TEXT NOT NULL
    )
  `);

  // Additive migration for installs that predate the window_start column.
  await db.execute("ALTER TABLE metrics_cache ADD COLUMN window_start TEXT").catch(() => {});
}

export function getWindowLowerBound(key: AggregateKey): string {
  if (key === "dashboard:last30d") {
    const since = new Date(Date.now() - 30 * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    return since.toISOString();
  }
  if (key.startsWith("heatmap:")) {
    const year = key.split(":")[1];
    return `${year}-01-01T00:00:00.000Z`;
  }
  return "";
}

export async function insertEvents(db: DatabaseAdapter, events: MetricEvent[]): Promise<void> {
  for (const event of events) {
    await insertEventRow(db, event);
  }
}

async function insertEventRow(db: DatabaseAdapter, event: MetricEvent): Promise<void> {
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
    ]
  );
}

export async function insertIfNotTombstoned(
  db: DatabaseAdapter,
  event: MetricEvent
): Promise<boolean> {
  const tombstones = await db.select<{ id: string }[]>(
    "SELECT id FROM metrics_event_tombstones WHERE id = ? LIMIT 1",
    [event.id]
  );
  if (tombstones.length > 0) return false;
  await insertEventRow(db, event);
  return true;
}

export async function insertEventsRespectingTombstones(
  db: DatabaseAdapter,
  events: MetricEvent[]
): Promise<void> {
  for (const event of events) {
    await insertIfNotTombstoned(db, event);
  }
}

export async function listEvents(db: DatabaseAdapter): Promise<MetricEvent[]> {
  const rows = await db.select<MetricEventRow[]>(
    `SELECT id, timestamp, local_date, tz_offset_min, device_id, event_type, work_id, payload, schema_version
     FROM metrics_events
     ORDER BY timestamp ASC, id ASC`
  );
  return rows.map(toMetricEvent);
}

export async function getSnapshotMetrics(db: DatabaseAdapter): Promise<SnapshotMetrics> {
  const rows = await db.select<SnapshotWorkRow[]>(
    `SELECT id, title, word_count
     FROM books
     ORDER BY updated_at DESC, title ASC`
  );

  return {
    totalWords: rows.reduce((sum, row) => sum + Number(row.word_count ?? 0), 0),
    perWork: rows.map((row) => ({
      workId: row.id,
      title: row.title,
      wordCount: Number(row.word_count ?? 0),
    })),
  };
}

export async function getCacheEntry(
  db: DatabaseAdapter,
  cacheKey: string
): Promise<MetricsCacheEntry | null> {
  const rows = await db.select<CacheRow[]>(
    `SELECT cache_key, aggregate_version, source_high_watermark, window_start, computed_at, payload
     FROM metrics_cache
     WHERE cache_key = ?
     LIMIT 1`,
    [cacheKey]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    cacheKey: row.cache_key,
    aggregateVersion: row.aggregate_version,
    sourceHighWatermark: row.source_high_watermark,
    windowStart: row.window_start ?? "",
    computedAt: row.computed_at,
    payload: JSON.parse(row.payload),
  };
}

export async function getSourceHighWatermark(
  db: DatabaseAdapter,
  key: AggregateKey
): Promise<string> {
  const { where, params } = buildAggregateWhere(key);
  const rows = await db.select<{ watermark: string | null }[]>(
    `SELECT MAX(timestamp) AS watermark FROM metrics_events ${where}`,
    params
  );
  return rows[0]?.watermark ?? "";
}

export async function getCategoryMeasuringSince(
  db: DatabaseAdapter,
  category: MetricsCategory
): Promise<string | null> {
  const { where, params } = buildCategoryWhere(category);
  const rows = await db.select<{ timestamp: string | null }[]>(
    `SELECT MIN(timestamp) AS timestamp FROM metrics_events ${where}`,
    params
  );
  return rows[0]?.timestamp ?? null;
}

export async function listEventsForAggregate(
  db: DatabaseAdapter,
  key: AggregateKey,
  options: { limit: number; offset: number }
): Promise<MetricEvent[]> {
  const { where, params } = buildAggregateWhere(key);
  const rows = await db.select<MetricEventRow[]>(
    `SELECT id, timestamp, local_date, tz_offset_min, device_id, event_type, work_id, payload, schema_version
     FROM metrics_events
     ${where}
     ORDER BY timestamp ASC, id ASC
     LIMIT ? OFFSET ?`,
    [...params, options.limit, options.offset]
  );
  return rows.map(toMetricEvent);
}

export interface DayWordTotal {
  date: string;
  words: number;
}

export async function listDailyWritingTotals(db: DatabaseAdapter): Promise<DayWordTotal[]> {
  const rows = await db.select<{ local_date: string; total: number | null }[]>(
    `SELECT local_date, SUM(words) AS total
       FROM (
         SELECT local_date,
                CAST(COALESCE(json_extract(payload, '$.words'), 0) AS INTEGER) AS words
           FROM metrics_events
          WHERE event_type = 'writing.typed'
         UNION ALL
         SELECT local_date,
                CAST(COALESCE(json_extract(payload, '$.typedWords'), 0) AS INTEGER) AS words
           FROM metrics_events
          WHERE event_type = 'aggregate.daily'
       )
      GROUP BY local_date`
  );
  return rows.map((row) => ({
    date: row.local_date,
    words: Number(row.total ?? 0),
  }));
}

export async function getDailyWritingHighWatermark(db: DatabaseAdapter): Promise<string> {
  const rows = await db.select<{ watermark: string | null }[]>(
    "SELECT MAX(timestamp) AS watermark FROM metrics_events WHERE event_type = 'writing.typed'"
  );
  return rows[0]?.watermark ?? "";
}

export async function purgeEventsByPrefix(
  db: DatabaseAdapter,
  eventTypePrefix: string,
  deviceId: string,
  deletedAt: string
): Promise<number> {
  const pattern = `${eventTypePrefix}%`;
  const rows = await db.select<{ id: string }[]>(
    "SELECT id FROM metrics_events WHERE event_type LIKE ?",
    [pattern]
  );

  for (const row of rows) {
    await db.execute(
      `INSERT OR IGNORE INTO metrics_event_tombstones
        (id, deleted_at, device_id, reason)
       VALUES (?, ?, ?, ?)`,
      [row.id, deletedAt, deviceId, "category-opt-out"]
    );
  }

  await db.execute("DELETE FROM metrics_events WHERE event_type LIKE ?", [pattern]);
  return rows.length;
}

export async function upsertCache(db: DatabaseAdapter, entry: MetricsCacheEntry): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO metrics_cache
      (cache_key, aggregate_version, source_high_watermark, window_start, computed_at, payload)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entry.cacheKey,
      entry.aggregateVersion,
      entry.sourceHighWatermark,
      entry.windowStart,
      entry.computedAt,
      JSON.stringify(entry.payload),
    ]
  );
}

export async function invalidateCache(db: DatabaseAdapter, prefixes: string[]): Promise<void> {
  for (const prefix of prefixes) {
    await db.execute("DELETE FROM metrics_cache WHERE cache_key LIKE ?", [`${prefix}%`]);
  }
}

export async function invalidateAllAggregateCaches(db: DatabaseAdapter): Promise<void> {
  await db.execute("DELETE FROM metrics_cache");
}

export interface TombstoneRow {
  id: string;
  deletedAt: string;
  deviceId: string;
  reason: string;
}

export async function listUnpushedEvents(
  db: DatabaseAdapter,
  limit: number
): Promise<MetricEvent[]> {
  const rows = await db.select<MetricEventRow[]>(
    `SELECT id, timestamp, local_date, tz_offset_min, device_id, event_type, work_id, payload, schema_version
     FROM metrics_events
     WHERE pushed_at IS NULL
     ORDER BY timestamp ASC, id ASC
     LIMIT ?`,
    [limit]
  );
  return rows.map(toMetricEvent);
}

export async function countUnpushedEvents(db: DatabaseAdapter): Promise<number> {
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM metrics_events WHERE pushed_at IS NULL"
  );
  return rows[0]?.n ?? 0;
}

export async function compactUnpushedRawMetricEvents(db: DatabaseAdapter): Promise<number> {
  const rows = await db.select<MetricEventRow[]>(
    `SELECT id, timestamp, local_date, tz_offset_min, device_id, event_type, work_id, payload, schema_version
       FROM metrics_events
      WHERE pushed_at IS NULL
        AND event_type != 'aggregate.daily'
      ORDER BY device_id ASC, local_date ASC, timestamp ASC, id ASC`
  );
  if (rows.length === 0) return 0;

  const bucketRows = new Map<string, MetricEventRow[]>();
  for (const row of rows) {
    const key = `${row.device_id}\u0000${row.local_date}`;
    const bucket = bucketRows.get(key) ?? [];
    bucket.push(row);
    bucketRows.set(key, bucket);
  }

  const buckets: DailyAggregateAccumulator[] = [];
  for (const bucket of bucketRows.values()) {
    // Each aggregate embeds the ids of the raw events it absorbed (for
    // cross-device dedup), and that payload is synced inline in the object's
    // `meta` field. Cap the source events per segment so meta stays bounded;
    // a busy day produces several disjoint aggregates instead of one huge row.
    // The read side already sums aggregates per date, so the split is lossless.
    for (let start = 0; start < bucket.length; start += MAX_SOURCE_EVENTS_PER_SEGMENT) {
      const segment = bucket.slice(start, start + MAX_SOURCE_EVENTS_PER_SEGMENT);
      const acc = createDailyAggregateAccumulator(segment);
      for (const row of segment) {
        addRowToDailyAggregate(acc, row);
      }
      buckets.push(acc);
    }
  }

  for (const acc of buckets) {
    await upsertDailyAggregateEvent(db, acc);
  }

  for (const row of rows) {
    await db.execute("DELETE FROM metrics_events WHERE id = ?", [row.id]);
  }

  await invalidateAllAggregateCaches(db);
  return rows.length;
}

export async function markEventPushed(
  db: DatabaseAdapter,
  id: string,
  pushedAt: string
): Promise<void> {
  await db.execute("UPDATE metrics_events SET pushed_at = ? WHERE id = ?", [pushedAt, id]);
}

export async function listUnpushedTombstones(
  db: DatabaseAdapter,
  limit: number
): Promise<TombstoneRow[]> {
  const rows = await db.select<
    { id: string; deleted_at: string; device_id: string; reason: string }[]
  >(
    `SELECT id, deleted_at, device_id, reason
     FROM metrics_event_tombstones
     WHERE pushed_at IS NULL
     ORDER BY deleted_at ASC, id ASC
     LIMIT ?`,
    [limit]
  );
  return rows.map((row) => ({
    id: row.id,
    deletedAt: row.deleted_at,
    deviceId: row.device_id,
    reason: row.reason,
  }));
}

export async function markTombstonePushed(
  db: DatabaseAdapter,
  id: string,
  pushedAt: string
): Promise<void> {
  await db.execute("UPDATE metrics_event_tombstones SET pushed_at = ? WHERE id = ?", [
    pushedAt,
    id,
  ]);
}

export async function applyRemoteEvent(
  db: DatabaseAdapter,
  event: MetricEvent,
  pushedAt: string
): Promise<boolean> {
  const tombstones = await db.select<{ id: string }[]>(
    "SELECT id FROM metrics_event_tombstones WHERE id = ? LIMIT 1",
    [event.id]
  );
  if (tombstones.length > 0) return false;
  await db.execute(
    `INSERT OR IGNORE INTO metrics_events
      (id, timestamp, local_date, tz_offset_min, device_id, event_type, work_id, payload, schema_version, pushed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      pushedAt,
    ]
  );
  if (event.eventType === "aggregate.daily") {
    await suppressCompactedSourceEvents(db, event, pushedAt);
  }
  return true;
}

export async function applyRemoteTombstone(
  db: DatabaseAdapter,
  tombstone: TombstoneRow,
  pushedAt: string
): Promise<void> {
  await db.execute(
    `INSERT OR IGNORE INTO metrics_event_tombstones
      (id, deleted_at, device_id, reason, pushed_at)
     VALUES (?, ?, ?, ?, ?)`,
    [tombstone.id, tombstone.deletedAt, tombstone.deviceId, tombstone.reason, pushedAt]
  );
  await db.execute("DELETE FROM metrics_events WHERE id = ?", [tombstone.id]);
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

async function suppressCompactedSourceEvents(
  db: DatabaseAdapter,
  event: MetricEvent,
  pushedAt: string
): Promise<void> {
  const payload = event.payload as Partial<DailyAggregateMetricPayload>;
  if (!Array.isArray(payload.sourceEventIds)) return;

  for (const sourceId of payload.sourceEventIds) {
    if (typeof sourceId !== "string" || sourceId === event.id) continue;
    await db.execute(
      `INSERT OR IGNORE INTO metrics_event_tombstones
        (id, deleted_at, device_id, reason, pushed_at)
       VALUES (?, ?, ?, ?, ?)`,
      [sourceId, event.timestamp, event.deviceId, "compacted", pushedAt]
    );
    await db.execute("DELETE FROM metrics_events WHERE id = ?", [sourceId]);
  }
}

interface DailyAggregateAccumulator {
  id: string;
  timestamp: string;
  localDate: string;
  tzOffsetMin: number;
  deviceId: string;
  rawEvents: number;
  sourceEventIds: string[];
  typedWords: number;
  deletedWords: number;
  pastedWords: number;
  activeSec: number;
  deepestSessionSec: number;
  timeOfDay: Map<number, number>;
  timeByWork: Map<string, number>;
}

function createDailyAggregateAccumulator(rows: MetricEventRow[]): DailyAggregateAccumulator {
  const first = rows[0];
  const segment = hashMetricIds(rows.map((row) => row.id));
  return {
    id: `aggregate:daily:v1:${first.device_id}:${first.local_date}:${segment}`,
    timestamp: first.timestamp,
    localDate: first.local_date,
    tzOffsetMin: first.tz_offset_min,
    deviceId: first.device_id,
    rawEvents: 0,
    sourceEventIds: [],
    typedWords: 0,
    deletedWords: 0,
    pastedWords: 0,
    activeSec: 0,
    deepestSessionSec: 0,
    timeOfDay: new Map(),
    timeByWork: new Map(),
  };
}

function hashMetricIds(ids: string[]): string {
  let hash = 0x811c9dc5;
  for (const id of [...ids].sort()) {
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function addRowToDailyAggregate(acc: DailyAggregateAccumulator, row: MetricEventRow): void {
  acc.rawEvents += 1;
  acc.sourceEventIds.push(row.id);
  if (row.timestamp > acc.timestamp) acc.timestamp = row.timestamp;

  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  switch (row.event_type) {
    case "writing.typed": {
      const words = getNumber(payload.words);
      acc.typedWords += words;
      addHourWords(acc, row, words);
      break;
    }
    case "writing.deleted": {
      const words = getNumber(payload.words);
      acc.deletedWords += words;
      addHourWords(acc, row, -words);
      break;
    }
    case "writing.pasted": {
      const words = getNumber(payload.words);
      acc.pastedWords += words;
      addHourWords(acc, row, words);
      break;
    }
    case "session.active": {
      const activeSec = getNumber(payload.activeSec);
      acc.activeSec += activeSec;
      if (row.work_id) {
        acc.timeByWork.set(row.work_id, (acc.timeByWork.get(row.work_id) ?? 0) + activeSec);
      }
      break;
    }
    case "session.ended":
      acc.deepestSessionSec = Math.max(acc.deepestSessionSec, getNumber(payload.deepestStreakSec));
      break;
  }
}

async function upsertDailyAggregateEvent(
  db: DatabaseAdapter,
  acc: DailyAggregateAccumulator
): Promise<void> {
  const payload: DailyAggregateMetricPayload = {
    bucket: DAILY_AGGREGATE_BUCKET,
    date: acc.localDate,
    rawEvents: acc.rawEvents,
    sourceEventIds: [...acc.sourceEventIds].sort(),
    typedWords: acc.typedWords,
    deletedWords: acc.deletedWords,
    pastedWords: acc.pastedWords,
    activeSec: acc.activeSec,
    deepestSessionSec: acc.deepestSessionSec,
    timeOfDay: Array.from(acc.timeOfDay.entries())
      .sort(([a], [b]) => a - b)
      .map(([hour, words]) => ({ hour, words })),
    timeByWork: Array.from(acc.timeByWork.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([workId, activeSec]) => ({ workId, activeSec })),
  };

  await db.execute(
    `INSERT OR IGNORE INTO metrics_events
      (id, timestamp, local_date, tz_offset_min, device_id, event_type, work_id, payload, schema_version, pushed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      acc.id,
      acc.timestamp,
      acc.localDate,
      acc.tzOffsetMin,
      acc.deviceId,
      "aggregate.daily",
      null,
      JSON.stringify(payload),
      1,
    ]
  );
}

function addHourWords(acc: DailyAggregateAccumulator, row: MetricEventRow, words: number): void {
  const localTime = new Date(new Date(row.timestamp).getTime() + row.tz_offset_min * 60_000);
  const hour = localTime.getUTCHours();
  acc.timeOfDay.set(hour, (acc.timeOfDay.get(hour) ?? 0) + words);
}

function getNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function buildAggregateWhere(key: AggregateKey): {
  where: string;
  params: unknown[];
} {
  if (key.startsWith("heatmap:")) {
    const year = key.split(":")[1];
    return {
      where:
        "WHERE local_date >= ? AND local_date < ? AND (event_type LIKE 'writing.%' OR event_type = 'aggregate.daily')",
      params: [`${year}-01-01`, `${Number(year) + 1}-01-01`],
    };
  }

  if (key === "dashboard:last30d") {
    return {
      where: "WHERE timestamp >= ?",
      params: [getWindowLowerBound(key)],
    };
  }

  return {
    where: "WHERE event_type = 'writing.typed'",
    params: [],
  };
}

function buildCategoryWhere(category: MetricsCategory): {
  where: string;
  params: unknown[];
} {
  if (category === "writing") {
    return { where: "WHERE event_type LIKE 'writing.%'", params: [] };
  }

  if (category === "time") {
    return { where: "WHERE event_type LIKE 'session.%'", params: [] };
  }

  return {
    where: "WHERE event_type LIKE 'writing.%' OR event_type LIKE 'session.%'",
    params: [],
  };
}
