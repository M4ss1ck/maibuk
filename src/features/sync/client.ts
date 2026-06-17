import PocketBase from "pocketbase";
import type { SyncItemMeta, NoteSyncItemMeta } from "./types";

export type ObjectKind = "book" | "note" | "version" | "metric";
export const APP_NAME = "maibuk";

export interface RemoteObject {
  remoteId: string;
  kind: ObjectKind;
  key: string;
  group: string;
  checksum: string;
  deleted: boolean;
  meta: string;
  updatedAt: number;
  updatedIso: string;
}

export interface PushObjectInput {
  kind: ObjectKind;
  key: string;
  group?: string;
  checksum?: string;
  meta?: string;
  content?: Blob;
  remoteId?: string;
}

const OBJECT_LIST_FIELDS = "id,kind,key,group,checksum,deleted,meta,updated";

let pb: PocketBase | null = null;

/**
 * Lets users type a bare host ("sync.example.com") without the scheme.
 * Defaults to https when no protocol is present; leaves an explicit
 * http:// or https:// untouched. Empty input stays empty.
 */
export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function initClient(url: string): void {
  pb = new PocketBase(url);
  // The SDK auto-cancels a pending request when another hits the same path.
  // Sync fires many same-collection requests (list/push/pull per book and
  // version), and rehydrate's background auth-refresh can overlap a manual
  // sync — auto-cancellation surfaces those as spurious connection failures.
  // We manage request lifecycle ourselves, so disable it.
  pb.autoCancellation(false);
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

function toRemoteObject(record: Record<string, unknown>): RemoteObject {
  const updatedIso = (record.updated as string | undefined) ?? "";
  return {
    remoteId: record.id as string,
    kind: record.kind as ObjectKind,
    key: record.key as string,
    group: (record.group as string | undefined) ?? "",
    checksum: (record.checksum as string | undefined) ?? "",
    deleted: Boolean(record.deleted),
    meta: (record.meta as string | undefined) ?? "",
    updatedAt: parsePocketBaseDate(updatedIso),
    updatedIso,
  };
}

function buildObjectFormData(
  input: PushObjectInput,
  userId: string,
  deleted: boolean,
): FormData {
  const formData = new FormData();
  formData.append("user", userId);
  formData.append("app_name", APP_NAME);
  formData.append("kind", input.kind);
  formData.append("key", input.key);
  formData.append("group", input.group ?? "");
  formData.append("checksum", input.checksum ?? "");
  formData.append("meta", input.meta ?? "");
  formData.append("deleted", String(deleted));
  if (input.content) {
    formData.append("content", input.content, `${input.key}.bin`);
  }
  return formData;
}

export async function pushObject(input: PushObjectInput): Promise<string> {
  const client = getClient();
  const userId = client.authStore.record?.id;
  if (!userId) throw new Error("Not authenticated");

  const formData = buildObjectFormData(input, userId, false);
  if (input.remoteId) {
    const record = await client.collection("objects").update(input.remoteId, formData);
    return (record.id as string | undefined) ?? input.remoteId;
  }

  const record = await client.collection("objects").create(formData);
  return (record.id as string | undefined) ?? "";
}

export async function pullObjectContent(remoteId: string): Promise<Uint8Array | null> {
  const client = getClient();

  try {
    const record = await client.collection("objects").getOne(remoteId);
    if (!record.content) return null;

    const fileUrl = client.files.getURL(record, record.content);
    const response = await fetch(fileUrl);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch {
    return null;
  }
}

export async function listObjects(kind: ObjectKind, group?: string): Promise<RemoteObject[]> {
  const client = getClient();

  const filters = [`app_name = "${APP_NAME}"`, `kind = "${kind}"`, "deleted = false"];
  if (group !== undefined) {
    filters.push(`group = "${group}"`);
  }

  const records = await client.collection("objects").getFullList({
    filter: filters.join(" && "),
    sort: "updated",
    fields: OBJECT_LIST_FIELDS,
  });

  return records.map((record) => toRemoteObject(record as Record<string, unknown>));
}

export async function pullObjectsSince(
  kind: ObjectKind,
  sinceIso: string,
): Promise<RemoteObject[]> {
  const client = getClient();

  const filters = [`app_name = "${APP_NAME}"`, `kind = "${kind}"`];
  if (sinceIso) {
    filters.push(`updated > "${sinceIso}"`);
  }

  const records = await client.collection("objects").getFullList({
    filter: filters.join(" && "),
    sort: "updated",
    fields: OBJECT_LIST_FIELDS,
  });

  return records.map((record) => toRemoteObject(record as Record<string, unknown>));
}

export async function softDeleteObject(
  kind: ObjectKind,
  key: string,
  meta?: string,
): Promise<void> {
  const client = getClient();
  const userId = client.authStore.record?.id;
  if (!userId) throw new Error("Not authenticated");

  const filter = `app_name = "${APP_NAME}" && kind = "${kind}" && key = "${key}"`;
  const existing = await client.collection("objects").getList(1, 1, { filter });

  const input: PushObjectInput = { kind, key, meta };
  const formData = buildObjectFormData(input, userId, true);
  if (existing.items.length > 0) {
    await client.collection("objects").update(existing.items[0].id, formData);
  } else {
    try {
      await client.collection("objects").create(formData);
    } catch (error) {
      if (!isKeyUniqueConstraintError(error)) throw error;

      const racedExisting = await client.collection("objects").getList(1, 1, { filter });
      if (racedExisting.items.length === 0) throw error;

      await client.collection("objects").update(racedExisting.items[0].id, formData);
    }
  }
}

export function isKeyUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: number }).status;
  if (status !== 400 && status !== 409) return false;

  const fieldErrors = (error as {
    data?: { data?: Record<string, { code?: string; message?: string }> };
  }).data?.data;
  if (!fieldErrors) return false;

  return Object.values(fieldErrors).some((fieldError) => {
    const code = fieldError.code?.toLowerCase() ?? "";
    const message = fieldError.message?.toLowerCase() ?? "";
    return code.includes("unique") || message.includes("unique");
  });
}

export async function pushBookBlob(
  bookId: string,
  encryptedData: Blob,
  checksum: string,
  remoteId?: string
): Promise<void> {
  await pushObject({ kind: "book", key: bookId, checksum, content: encryptedData, remoteId });
}

export async function pullBookBlob(
  bookId: string
): Promise<{ data: Uint8Array; checksum: string } | null> {
  const rows = await listObjects("book");
  const row = rows.find((remoteObject) => remoteObject.key === bookId);
  if (!row) return null;

  const data = await pullObjectContent(row.remoteId);
  if (!data) return null;
  return { data, checksum: row.checksum };
}

export async function deleteRemoteBook(bookId: string): Promise<void> {
  await softDeleteObject("book", bookId);
}

export async function pushNoteBlob(
  noteId: string,
  encryptedData: Blob,
  checksum: string,
  remoteId?: string
): Promise<void> {
  const client = getClient();
  const userId = client.authStore.record?.id;
  if (!userId) throw new Error("Not authenticated");

  const formData = new FormData();
  formData.append("encrypted_data", encryptedData, `${noteId}.bin`);
  formData.append("checksum", checksum);
  formData.append("user", userId);
  formData.append("note_id", noteId);

  // The caller already knows the remote record id (from listRemoteNotes), so
  // update it directly instead of re-querying. No id means a new record.
  if (remoteId) {
    await client.collection("note_items").update(remoteId, formData);
  } else {
    await client.collection("note_items").create(formData);
  }
}

export async function pullNoteBlob(
  noteId: string
): Promise<{ data: Uint8Array; checksum: string } | null> {
  const client = getClient();

  const records = await client
    .collection("note_items")
    .getList(1, 1, { filter: `note_id = "${noteId}"` });

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

export async function deleteRemoteNote(noteId: string): Promise<void> {
  const client = getClient();
  const existing = await client
    .collection("note_items")
    .getList(1, 1, { filter: `note_id = "${noteId}"` });

  if (existing.items.length === 0) return;

  await client.collection("note_items").delete(existing.items[0].id);
}

export async function listRemoteNotes(): Promise<NoteSyncItemMeta[]> {
  const client = getClient();

  const records = await client
    .collection("note_items")
    .getFullList({ fields: "id,note_id,checksum,updated" });

  return records.map((record) => ({
    remoteId: record.id,
    noteId: record.note_id as string,
    checksum: record.checksum as string,
    updatedAt: parsePocketBaseDate(record.updated as string),
  }));
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
// owner-scoped via API rules. PB's system `id` is auto-generated; the
// client-minted UUID lives in `client_id` with a unique-per-user index.

export interface MetricsEventRowPayload {
  client_id: string;
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
  client_id: string;
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
    if (isClientIdUniqueConstraintError(error)) return;
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
    if (isClientIdUniqueConstraintError(error)) return;
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
        "client_id,device_id,timestamp,local_date,tz_offset_min,event_type,work_id,schema_version,encrypted_payload,updated",
    });
  return records.map((record) => ({
    client_id: record.client_id as string,
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
      fields: "client_id,device_id,deleted_at,reason,updated",
    });
  return records.map((record) => ({
    client_id: record.client_id as string,
    device_id: record.device_id as string,
    deleted_at: record.deleted_at as string,
    reason: record.reason as string,
    updated: record.updated as string,
  }));
}

function isClientIdUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: number }).status;
  if (status !== 400 && status !== 409) return false;

  const clientIdError = (error as {
    data?: { data?: Record<string, { code?: string; message?: string }> };
  }).data?.data?.client_id;

  const code = clientIdError?.code?.toLowerCase() ?? "";
  const message = clientIdError?.message?.toLowerCase() ?? "";
  return code.includes("unique") || message.includes("unique");
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
  const rows = await listObjects("book");

  return rows.map((row) => ({
    remoteId: row.remoteId,
    bookId: row.key,
    checksum: row.checksum,
    updatedAt: row.updatedAt,
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
