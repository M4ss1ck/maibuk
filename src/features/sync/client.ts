// Sync client. The server is blob-agnostic: it stores a generic `objects`
// envelope and enforces only owner-CRUD. ALL app-specific invariants (kind
// vocabulary, key/group conventions, plaintext-vs-encrypted split, version/
// metric immutability, soft-delete-only) are enforced HERE, not by the server.
// See the maibuk-sync repo's docs/object-contract.md before changing this file.
import PocketBase from "pocketbase";
import type { SyncItemMeta, NoteSyncItemMeta } from "@/features/sync/types";
import { encryptMeta, decryptMeta } from "@/features/sync/crypto";

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

function buildObjectFormData(input: PushObjectInput, userId: string, deleted: boolean): FormData {
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
  sinceIso: string
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
  meta?: string
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

async function objectExists(kind: ObjectKind, key: string): Promise<boolean> {
  const client = getClient();
  const filter = `app_name = "${APP_NAME}" && kind = "${kind}" && key = "${key}"`;
  const existing = await client.collection("objects").getList(1, 1, { filter });
  return existing.items.length > 0;
}

export function isKeyUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: number }).status;
  if (status !== 400 && status !== 409) return false;

  const fieldErrors = (
    error as {
      data?: { data?: Record<string, { code?: string; message?: string }> };
    }
  ).data?.data;
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
  bookId: string,
  remoteId?: string
): Promise<{ data: Uint8Array; checksum: string } | null> {
  // Callers that already hold the remote object pass its remoteId so we skip the
  // full-list lookup (otherwise pulling N books would re-list every book N times).
  if (remoteId) {
    const data = await pullObjectContent(remoteId);
    return data ? { data, checksum: "" } : null;
  }

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
  await pushObject({ kind: "note", key: noteId, checksum, content: encryptedData, remoteId });
}

export async function pullNoteBlob(
  noteId: string,
  remoteId?: string
): Promise<{ data: Uint8Array; checksum: string } | null> {
  // Callers that already hold the remote object pass its remoteId so we skip the
  // full-list lookup (otherwise pulling N notes would re-list every note N times).
  if (remoteId) {
    const data = await pullObjectContent(remoteId);
    return data ? { data, checksum: "" } : null;
  }

  const rows = await listObjects("note");
  const row = rows.find((r) => r.key === noteId);
  if (!row) return null;
  const data = await pullObjectContent(row.remoteId);
  if (!data) return null;
  return { data, checksum: row.checksum };
}

export async function deleteRemoteNote(noteId: string): Promise<void> {
  await softDeleteObject("note", noteId);
}

export async function listRemoteNotes(): Promise<NoteSyncItemMeta[]> {
  const rows = await listObjects("note");
  return rows.map((r) => ({
    remoteId: r.remoteId,
    noteId: r.key,
    checksum: r.checksum,
    updatedAt: r.updatedAt,
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

// --- Metrics sync over generic objects -------------------------------------
// Metric event uploads are compact aggregate segments, not one remote row per
// keystroke event. PB's system `id` is auto-generated; the client-minted
// segment/tombstone id lives in `client_id` and maps to generic object `key`.

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

export async function pushMetricsEventRow(row: MetricsEventRowPayload): Promise<void> {
  if (await objectExists("metric", row.client_id)) return;

  const meta = await encryptMeta({
    device_id: row.device_id,
    timestamp: row.timestamp,
    local_date: row.local_date,
    tz_offset_min: row.tz_offset_min,
    event_type: row.event_type,
    work_id: row.work_id,
    schema_version: row.schema_version,
    encrypted_payload: row.encrypted_payload,
  });
  try {
    await pushObject({ kind: "metric", key: row.client_id, meta });
  } catch (error) {
    if (isKeyUniqueConstraintError(error)) return;
    throw error;
  }
}

export async function pushMetricsTombstoneRow(row: MetricsTombstoneRowPayload): Promise<void> {
  const meta = await encryptMeta({
    device_id: row.device_id,
    deleted_at: row.deleted_at,
    reason: row.reason,
  });
  await softDeleteObject("metric", row.client_id, meta);
}

export async function pullMetricsEventRowsSince(
  sinceIso: string
): Promise<RemoteMetricsEventRow[]> {
  const rows = await pullObjectsSince("metric", sinceIso);
  const out: RemoteMetricsEventRow[] = [];
  for (const r of rows) {
    if (r.deleted) continue;
    const m = await decryptMeta(r.meta);
    out.push({
      client_id: r.key,
      device_id: m.device_id as string,
      timestamp: m.timestamp as string,
      local_date: m.local_date as string,
      tz_offset_min: m.tz_offset_min as number,
      event_type: m.event_type as string,
      work_id: (m.work_id as string | null) ?? null,
      schema_version: m.schema_version as number,
      encrypted_payload: m.encrypted_payload as string,
      updated: r.updatedIso,
    });
  }
  return out;
}

export async function pullMetricsTombstoneRowsSince(
  sinceIso: string
): Promise<RemoteMetricsTombstoneRow[]> {
  const rows = await pullObjectsSince("metric", sinceIso);
  const out: RemoteMetricsTombstoneRow[] = [];
  for (const r of rows) {
    if (!r.deleted) continue;
    const m = await decryptMeta(r.meta);
    out.push({
      client_id: r.key,
      device_id: m.device_id as string,
      deleted_at: m.deleted_at as string,
      reason: m.reason as string,
      updated: r.updatedIso,
    });
  }
  return out;
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
  const rows = await listObjects("version", bookId);
  const out: RemoteVersionMeta[] = [];
  for (const r of rows) {
    const meta = await decryptMeta(r.meta);
    out.push({
      remoteId: r.remoteId,
      versionId: r.key,
      bookId: r.group,
      checksum: r.checksum,
      name: (meta.name as string | null) ?? null,
      triggerType: (meta.triggerType as string) ?? "manual",
      createdAt: (meta.createdAt as number) ?? 0,
      wordCount: (meta.wordCount as number) ?? 0,
    });
  }
  return out;
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
  const encryptedMeta = await encryptMeta({
    name: meta.name,
    triggerType: meta.triggerType,
    createdAt: meta.createdAt,
    wordCount: meta.wordCount,
  });
  await pushObject({
    kind: "version",
    key: meta.versionId,
    group: meta.bookId,
    checksum: meta.checksum,
    meta: encryptedMeta,
    content: encryptedData,
  });
}

export async function pullVersionBlob(remoteId: string): Promise<{ data: Uint8Array } | null> {
  const data = await pullObjectContent(remoteId);
  return data ? { data } : null;
}
