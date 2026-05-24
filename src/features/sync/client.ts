import PocketBase from "pocketbase";
import type { SyncItemMeta } from "./types";

let pb: PocketBase | null = null;

export function initClient(url: string): void {
  pb = new PocketBase(url);
}

function getClient(): PocketBase {
  if (!pb) {
    throw new Error("PocketBase client not initialized. Call initClient() first.");
  }
  return pb;
}

export async function login(
  email: string,
  password: string
): Promise<{ email: string; token: string }> {
  const client = getClient();
  const authData = await client.collection("users").authWithPassword(email, password);
  return {
    email: authData.record.email,
    token: client.authStore.token,
  };
}

export async function register(
  email: string,
  password: string
): Promise<{ email: string; token: string }> {
  const client = getClient();
  await client.collection("users").create({
    email,
    password,
    passwordConfirm: password,
  });
  // Auto-login after registration
  return login(email, password);
}

export async function loginWithOAuth(provider: string): Promise<{ email: string; token: string }> {
  const client = getClient();
  const authData = await client.collection("users").authWithOAuth2({ provider });
  return {
    email: authData.record.email,
    token: client.authStore.token,
  };
}

export function restoreAuth(token: string): void {
  const client = getClient();
  client.authStore.save(token);
}

export async function refreshAuth(): Promise<{ email: string; token: string }> {
  const client = getClient();
  const authData = await client.collection("users").authRefresh();
  return {
    email: authData.record.email,
    token: client.authStore.token,
  };
}

export function logout(): void {
  if (pb) {
    pb.authStore.clear();
  }
}

export function isAuthenticated(): boolean {
  return pb?.authStore.isValid ?? false;
}

export function getAuthToken(): string | null {
  return pb?.authStore.token ?? null;
}

export function getAuthModel(): unknown {
  return pb?.authStore.record ?? null;
}

export async function pushBookBlob(
  bookId: string,
  encryptedData: Blob,
  checksum: string
): Promise<void> {
  const client = getClient();
  const userId = client.authStore.record?.id;
  if (!userId) throw new Error("Not authenticated");

  // Check if a record already exists for this book
  const existing = await client
    .collection("sync_items")
    .getList(1, 1, { filter: `book_id = "${bookId}"` });

  const formData = new FormData();
  formData.append("encrypted_data", encryptedData, `${bookId}.bin`);
  formData.append("checksum", checksum);
  formData.append("user", userId);
  formData.append("book_id", bookId);

  if (existing.items.length > 0) {
    await client.collection("sync_items").update(existing.items[0].id, formData);
  } else {
    await client.collection("sync_items").create(formData);
  }
}

export async function pullBookBlob(
  bookId: string
): Promise<{ data: Uint8Array; checksum: string } | null> {
  const client = getClient();

  const records = await client
    .collection("sync_items")
    .getList(1, 1, { filter: `book_id = "${bookId}"` });

  if (records.items.length === 0) return null;

  const record = records.items[0];
  const fileUrl = client.files.getURL(record, record.encrypted_data);
  const response = await fetch(fileUrl);
  const arrayBuffer = await response.arrayBuffer();

  return {
    data: new Uint8Array(arrayBuffer),
    checksum: record.checksum as string,
  };
}

/** Normalizes PocketBase datetime strings to Unix seconds. Returns 0 for unparseable input. */
export function parsePocketBaseDate(dateStr: string): number {
  if (!dateStr) return 0;
  // PocketBase uses exactly one space between date and time, replace with T for ISO 8601
  let iso = dateStr.replace(" ", "T");
  if (!iso.endsWith("Z")) iso += "Z";
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return 0;
  return Math.floor(ms / 1000);
}

// --- Row-level metrics sync (replaces the old blob-per-everything model) ----
// Schema requirements live in
// docs/plans/2026-05-23-metrics-sync-pocketbase-schema.md. The two collections
// (`metrics_events_rows`, `metrics_tombstones_rows`) are append-only and
// owner-scoped via API rules.

export interface MetricsEventRowPayload {
  id: string;
  device_id: string;
  timestamp: string;
  local_date: string;
  tz_offset_min: number;
  event_type: string;
  work_id: string | null;
  schema_version: number;
  encrypted_payload: string;
}

export interface MetricsTombstoneRowPayload {
  id: string;
  device_id: string;
  deleted_at: string;
  reason: string;
}

export interface RemoteMetricsEventRow extends MetricsEventRowPayload {
  updated: string;
}

export interface RemoteMetricsTombstoneRow extends MetricsTombstoneRowPayload {
  updated: string;
}

export async function pushMetricsEventRow(
  row: MetricsEventRowPayload,
): Promise<void> {
  const client = getClient();
  const userId = client.authStore.record?.id;
  if (!userId) throw new Error("Not authenticated");
  try {
    await client.collection("metrics_events_rows").create({ ...row, user: userId });
  } catch (error) {
    // PB returns 400 with a unique-constraint violation when the row already
    // exists (a sibling device pushed it first). Treat as already-pushed.
    if (isUniqueConstraintError(error)) return;
    throw error;
  }
}

export async function pushMetricsTombstoneRow(
  row: MetricsTombstoneRowPayload,
): Promise<void> {
  const client = getClient();
  const userId = client.authStore.record?.id;
  if (!userId) throw new Error("Not authenticated");
  try {
    await client.collection("metrics_tombstones_rows").create({ ...row, user: userId });
  } catch (error) {
    if (isUniqueConstraintError(error)) return;
    throw error;
  }
}

export async function pullMetricsEventRowsSince(
  sinceIsoTimestamp: string,
): Promise<RemoteMetricsEventRow[]> {
  const client = getClient();
  const records = await client
    .collection("metrics_events_rows")
    .getFullList({
      filter: sinceIsoTimestamp
        ? `updated > "${sinceIsoTimestamp}"`
        : undefined,
      sort: "updated",
      fields:
        "id,device_id,timestamp,local_date,tz_offset_min,event_type,work_id,schema_version,encrypted_payload,updated",
    });
  return records.map((record) => ({
    id: record.id as string,
    device_id: record.device_id as string,
    timestamp: record.timestamp as string,
    local_date: record.local_date as string,
    tz_offset_min: record.tz_offset_min as number,
    event_type: record.event_type as string,
    work_id: (record.work_id as string | null) ?? null,
    schema_version: record.schema_version as number,
    encrypted_payload: record.encrypted_payload as string,
    updated: record.updated as string,
  }));
}

export async function pullMetricsTombstoneRowsSince(
  sinceIsoTimestamp: string,
): Promise<RemoteMetricsTombstoneRow[]> {
  const client = getClient();
  const records = await client
    .collection("metrics_tombstones_rows")
    .getFullList({
      filter: sinceIsoTimestamp
        ? `updated > "${sinceIsoTimestamp}"`
        : undefined,
      sort: "updated",
      fields: "id,device_id,deleted_at,reason,updated",
    });
  return records.map((record) => ({
    id: record.id as string,
    device_id: record.device_id as string,
    deleted_at: record.deleted_at as string,
    reason: record.reason as string,
    updated: record.updated as string,
  }));
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: number }).status;
  return status === 400 || status === 409;
}

export async function pushMetricsBlob(
  encryptedData: Blob,
  checksum: string,
): Promise<void> {
  const client = getClient();
  const userId = client.authStore.record?.id;
  if (!userId) throw new Error("Not authenticated");

  const existing = await client
    .collection("metrics_sync")
    .getList(1, 1, { filter: `user = "${userId}"` });

  const formData = new FormData();
  formData.append("encrypted_data", encryptedData, "metrics.bin");
  formData.append("checksum", checksum);
  formData.append("user", userId);

  if (existing.items.length > 0) {
    await client.collection("metrics_sync").update(existing.items[0].id, formData);
  } else {
    await client.collection("metrics_sync").create(formData);
  }
}

export async function pullMetricsBlob(
): Promise<{ data: Uint8Array; checksum: string } | null> {
  const client = getClient();
  const userId = client.authStore.record?.id;
  if (!userId) return null;

  const records = await client
    .collection("metrics_sync")
    .getList(1, 1, { filter: `user = "${userId}"` });

  if (records.items.length === 0) return null;

  const record = records.items[0];
  const fileUrl = client.files.getURL(record, record.encrypted_data);
  const response = await fetch(fileUrl);
  const arrayBuffer = await response.arrayBuffer();

  return {
    data: new Uint8Array(arrayBuffer),
    checksum: record.checksum as string,
  };
}

export async function listRemoteBooks(): Promise<SyncItemMeta[]> {
  const client = getClient();

  const records = await client
    .collection("sync_items")
    .getFullList({ fields: "id,book_id,checksum,updated" });

  return records.map((record) => ({
    remoteId: record.id,
    bookId: record.book_id as string,
    checksum: record.checksum as string,
    updatedAt: parsePocketBaseDate(record.updated as string),
  }));
}

export interface RemoteVersionMeta {
  remoteId: string;
  versionId: string;
  bookId: string;
  checksum: string;
  name: string | null;
  triggerType: string;
  createdAt: number;
  wordCount: number;
}

export async function listRemoteVersions(bookId?: string): Promise<RemoteVersionMeta[]> {
  const client = getClient();

  const filter = bookId ? `book_id = "${bookId}"` : "";
  const records = await client
    .collection("version_items")
    .getFullList({
      filter,
      fields: "id,version_id,book_id,checksum,version_name,version_trigger,version_created_at,word_count",
    });

  return records.map((record) => ({
    remoteId: record.id,
    versionId: record.version_id as string,
    bookId: record.book_id as string,
    checksum: record.checksum as string,
    name: (record.version_name as string | null) ?? null,
    triggerType: (record.version_trigger as string) ?? "manual",
    createdAt: (record.version_created_at as number) ?? 0,
    wordCount: (record.word_count as number) ?? 0,
  }));
}

export async function pushVersionBlob(
  meta: {
    versionId: string;
    bookId: string;
    checksum: string;
    name: string | null;
    triggerType: string;
    createdAt: number;
    wordCount: number;
  },
  encryptedData: Blob
): Promise<void> {
  const client = getClient();
  const userId = client.authStore.record?.id;
  if (!userId) throw new Error("Not authenticated");

  const formData = new FormData();
  formData.append("encrypted_data", encryptedData, `${meta.versionId}.bin`);
  formData.append("version_id", meta.versionId);
  formData.append("book_id", meta.bookId);
  formData.append("checksum", meta.checksum);
  formData.append("user", userId);
  if (meta.name !== null) {
    formData.append("version_name", meta.name);
  }
  formData.append("version_trigger", meta.triggerType);
  formData.append("version_created_at", String(meta.createdAt));
  formData.append("word_count", String(meta.wordCount));

  await client.collection("version_items").create(formData);
}

export async function pullVersionBlob(
  remoteId: string
): Promise<{ data: Uint8Array } | null> {
  const client = getClient();

  try {
    const record = await client.collection("version_items").getOne(remoteId);
    const fileUrl = client.files.getURL(record, record.encrypted_data);
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    return { data: new Uint8Array(arrayBuffer) };
  } catch {
    return null;
  }
}
