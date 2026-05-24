import { getDatabase } from "../../lib/db";
import { decrypt, encrypt } from "../sync/crypto";
import {
  applyRemoteEvent,
  applyRemoteTombstone,
  insertIfNotTombstoned,
  invalidateAllAggregateCaches,
  listUnpushedEvents,
  listUnpushedTombstones,
  markEventPushed,
  markTombstonePushed,
  type TombstoneRow,
} from "./events-repo";
import {
  pullMetricsEventRowsSince,
  pullMetricsTombstoneRowsSince,
  pushMetricsEventRow,
  pushMetricsTombstoneRow,
  type RemoteMetricsEventRow,
} from "../sync/client";
import type { MetricEvent, EventType, MetricPayload } from "./types";

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

interface BlobTombstoneRow {
  id: string;
  deleted_at: string;
  device_id: string;
  reason: string;
}

export interface MetricsSyncBlob {
  events: MetricEvent[];
  tombstones: BlobTombstoneRow[];
  updatedAt: number;
}

export async function serializeMetricsBatch(): Promise<string> {
  const db = await getDatabase();

  const eventRows = await db.select<MetricsEventRow[]>(
    `SELECT id, timestamp, local_date, tz_offset_min, device_id, event_type, work_id, payload, schema_version
    FROM metrics_events
    ORDER BY timestamp ASC, id ASC`,
  );

  const tombstoneRows = await db.select<BlobTombstoneRow[]>(
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

  if (snapshot.events.length > 0 || snapshot.tombstones.length > 0) {
    await invalidateAllAggregateCaches(db);
  }
}

// --- Row-level sync ---------------------------------------------------------
// New transport: each event / tombstone is one PocketBase row. Pulls are
// incremental via a per-table `updated > since` watermark; pushes are deltas
// driven by the local `pushed_at` columns. See
// docs/plans/2026-05-23-metrics-sync-pocketbase-schema.md for the required
// server schema.

const PUSH_BATCH_SIZE = 200;
const EVENT_WATERMARK_KEY = "maibuk.metrics.lastEventPullAt";
const TOMBSTONE_WATERMARK_KEY = "maibuk.metrics.lastTombstonePullAt";

function readWatermark(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeWatermark(key: string, value: string): void {
  if (!value) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable — accept that next pull will refetch a tail
    // window. Server enforces tombstone-wins so this is safe.
  }
}

function maxIso(values: string[]): string {
  return values.reduce((max, value) => (value > max ? value : max), "");
}

export async function syncMetricsRows(passphrase: string): Promise<void> {
  const db = await getDatabase();

  let touchedAggregateCache = false;

  // 1. PULL tombstones first so tombstone-wins applies to any concurrently
  //    pulled events.
  const tombstoneSince = readWatermark(TOMBSTONE_WATERMARK_KEY);
  const remoteTombstones = await pullMetricsTombstoneRowsSince(tombstoneSince);
  for (const remote of remoteTombstones) {
    const tombstone: TombstoneRow = {
      id: remote.client_id,
      deletedAt: remote.deleted_at,
      deviceId: remote.device_id,
      reason: remote.reason,
    };
    await applyRemoteTombstone(db, tombstone, remote.updated);
  }
  if (remoteTombstones.length > 0) {
    touchedAggregateCache = true;
    writeWatermark(
      TOMBSTONE_WATERMARK_KEY,
      maxIso(remoteTombstones.map((row) => row.updated)),
    );
  }

  // 2. PULL events. Decrypt each payload before applying.
  const eventSince = readWatermark(EVENT_WATERMARK_KEY);
  const remoteEvents = await pullMetricsEventRowsSince(eventSince);
  const processedEventUpdates: string[] = [];
  for (const remote of remoteEvents) {
    const event = await decodeRemoteEvent(remote, passphrase);
    if (!event) break;
    const inserted = await applyRemoteEvent(db, event, remote.updated);
    if (inserted) touchedAggregateCache = true;
    processedEventUpdates.push(remote.updated);
  }
  if (processedEventUpdates.length > 0) {
    writeWatermark(
      EVENT_WATERMARK_KEY,
      maxIso(processedEventUpdates),
    );
  }

  // 3. PUSH local-only tombstones.
  while (true) {
    const batch = await listUnpushedTombstones(db, PUSH_BATCH_SIZE);
    if (batch.length === 0) break;
    for (const tombstone of batch) {
      await pushMetricsTombstoneRow({
        client_id: tombstone.id,
        device_id: tombstone.deviceId,
        deleted_at: tombstone.deletedAt,
        reason: tombstone.reason,
      });
      await markTombstonePushed(db, tombstone.id, new Date().toISOString());
    }
  }

  // 4. PUSH local-only events.
  while (true) {
    const batch = await listUnpushedEvents(db, PUSH_BATCH_SIZE);
    if (batch.length === 0) break;
    for (const event of batch) {
      const encryptedPayload = await encryptPayload(event.payload, passphrase);
      await pushMetricsEventRow({
        client_id: event.id,
        device_id: event.deviceId,
        timestamp: event.timestamp,
        local_date: event.localDate,
        tz_offset_min: event.tzOffsetMin,
        event_type: event.eventType,
        work_id: event.workId,
        schema_version: event.schemaVersion,
        encrypted_payload: encryptedPayload,
      });
      await markEventPushed(db, event.id, new Date().toISOString());
    }
  }

  if (touchedAggregateCache) {
    await invalidateAllAggregateCaches(db);
  }
}

async function decodeRemoteEvent(
  remote: RemoteMetricsEventRow,
  passphrase: string,
): Promise<MetricEvent | null> {
  let payload: MetricPayload;
  try {
    const decrypted = await decrypt(
      base64ToUint8Array(remote.encrypted_payload),
      passphrase,
    );
    payload = JSON.parse(decrypted) as MetricPayload;
  } catch {
    // Skip rows we can't decrypt — wrong passphrase or corrupted ciphertext.
    // They stay on the server; another device with the right key can still
    // see them.
    return null;
  }
  return {
    id: remote.client_id,
    timestamp: remote.timestamp,
    localDate: remote.local_date,
    tzOffsetMin: remote.tz_offset_min,
    deviceId: remote.device_id,
    eventType: remote.event_type as EventType,
    workId: remote.work_id,
    payload,
    schemaVersion: remote.schema_version,
  };
}

async function encryptPayload(
  payload: MetricPayload,
  passphrase: string,
): Promise<string> {
  const ciphertext = await encrypt(JSON.stringify(payload), passphrase);
  return uint8ArrayToBase64(ciphertext);
}

function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.byteLength; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const data = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    data[i] = binary.charCodeAt(i);
  }
  return data;
}

// Used by the one-time blob → rows migration. Decrypts any legacy
// `metrics_sync` blob, applies it locally (with cache invalidation), and
// marks the local events / tombstones as already-pushed so we don't double-
// upload them under the new schema.
export async function applyLegacyBlobAndMarkPushed(
  snapshot: MetricsSyncBlob,
): Promise<void> {
  const db = await getDatabase();
  const pushedAt = new Date().toISOString();

  for (const tombstone of snapshot.tombstones) {
    await applyRemoteTombstone(
      db,
      {
        id: tombstone.id,
        deletedAt: tombstone.deleted_at,
        deviceId: tombstone.device_id,
        reason: tombstone.reason,
      },
      pushedAt,
    );
    await markTombstonePushed(db, tombstone.id, pushedAt);
  }
  for (const event of snapshot.events) {
    await applyRemoteEvent(db, event, pushedAt);
    await markEventPushed(db, event.id, pushedAt);
  }
  if (snapshot.events.length > 0 || snapshot.tombstones.length > 0) {
    await invalidateAllAggregateCaches(db);
  }
}
