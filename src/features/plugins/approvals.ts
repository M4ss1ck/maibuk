/**
 * Device-local Plugin approvals: the folder hash the author pinned, the Plugin
 * Permissions they granted, and whether the Plugin is enabled. The install and
 * permission flow (#442) writes these records; until it lands, only the E2E
 * `prepareDevice` seed writes them, so no user-reachable path installs a
 * Plugin. A v1 record (`granted` only) migrates to v2 on read; writers always
 * write v2. Approvals are device-local: never synced, never in a Backup.
 */

import { startupErrorValue } from "@/features/plugins/startup-error";
import type {
  PluginActivationRefusal,
  PluginApproval,
  PluginEnableResult,
  PluginManifest,
  PluginManagementEntry,
  PluginPermissionId,
} from "@/features/plugins/types";

export const PLUGIN_APPROVALS_STORAGE_KEY = "maibuk-plugins";

interface StoredApprovals {
  version: 2;
  approvals: readonly PluginApproval[];
}

function isPermissionList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((permission) => typeof permission === "string");
}

function hasBaseFields(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.pluginId === "string" &&
    typeof record.pinnedHash === "string" &&
    isPermissionList(record.granted)
  );
}

function readApprovedPermissions(
  value: unknown,
  granted: string[]
): { required: string[]; optional: string[] } {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (isPermissionList(record.required) && isPermissionList(record.optional)) {
      return { required: record.required, optional: record.optional };
    }
  }
  // A v1 record keeps no permission snapshot: its grants were all required.
  return { required: [...granted], optional: [] };
}

function readApprovedFiles(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const files: Record<string, string> = {};
  for (const [path, digest] of Object.entries(value as Record<string, unknown>)) {
    if (typeof digest === "string") files[path] = digest;
  }
  return files;
}

function readBuiltIn(value: unknown): PluginApproval["builtIn"] {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.shippedHash !== "string") return undefined;
  return {
    shippedHash: record.shippedHash,
    ...(typeof record.keptModifiedHash === "string"
      ? { keptModifiedHash: record.keptModifiedHash }
      : {}),
  };
}

/** Normalizes a stored record to v2; a v1 record fills its missing fields. */
function normalizeApproval(record: Record<string, unknown>): PluginApproval {
  const granted = record.granted as string[];
  const approval: PluginApproval = {
    pluginId: record.pluginId as string,
    pinnedHash: record.pinnedHash as string,
    granted: granted as PluginPermissionId[],
    enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    approvedVersion: typeof record.approvedVersion === "string" ? record.approvedVersion : "",
    approvedPermissions: readApprovedPermissions(record.approvedPermissions, granted),
    approvedFiles: readApprovedFiles(record.approvedFiles),
  };
  const builtIn = readBuiltIn(record.builtIn);
  if (builtIn) approval.builtIn = builtIn;
  if (typeof record.startupError === "string") approval.startupError = record.startupError;
  if (typeof record.notifiedHash === "string") approval.notifiedHash = record.notifiedHash;
  if (typeof record.notifiedBuiltInHash === "string") {
    approval.notifiedBuiltInHash = record.notifiedBuiltInHash;
  }
  return approval;
}

function read(): PluginApproval[] {
  try {
    const raw = localStorage.getItem(PLUGIN_APPROVALS_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return [];
    const approvals = (parsed as { approvals?: unknown }).approvals;
    if (!Array.isArray(approvals)) return [];
    return approvals.filter(hasBaseFields).map(normalizeApproval);
  } catch {
    return [];
  }
}

function write(approvals: PluginApproval[]): void {
  localStorage.setItem(PLUGIN_APPROVALS_STORAGE_KEY, serializePluginApprovals(approvals));
}

/** Serializes the v2 payload both the app and the E2E seed write. */
export function serializePluginApprovals(approvals: readonly PluginApproval[]): string {
  return JSON.stringify({ version: 2, approvals } satisfies StoredApprovals);
}

export function listPluginApprovals(): PluginApproval[] {
  return read();
}

export function getPluginApproval(pluginId: string): PluginApproval | null {
  return read().find((approval) => approval.pluginId === pluginId) ?? null;
}

export function savePluginApproval(approval: PluginApproval): void {
  write([...read().filter((current) => current.pluginId !== approval.pluginId), approval]);
}

export function removePluginApproval(pluginId: string): void {
  write(read().filter((approval) => approval.pluginId !== pluginId));
}

/**
 * Removes every stored Plugin approval: grants, enable state, and pinned
 * hashes. Reset settings (#442) clears them so a refresh re-seeds an untouched
 * Built-in from its shipped defaults while a modified copy stays for review.
 */
export function clearPluginApprovals(): void {
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
}

/**
 * Builds the record for a first-time approval: every required Plugin
 * Permission granted, the chosen optional ones, the author's copy pinned and
 * enabled. `digests` is the `pluginFileDigests` output for the approved folder.
 */
export function approvePluginCopy(
  manifest: PluginManifest,
  hash: string,
  digests: ReadonlyMap<string, string>,
  optionalGranted: readonly PluginPermissionId[] = []
): PluginApproval {
  const optional = manifest.permissions.optional.filter((permission) =>
    optionalGranted.includes(permission as PluginPermissionId)
  );
  const granted = [...manifest.permissions.required, ...optional] as PluginPermissionId[];
  return {
    pluginId: manifest.id,
    pinnedHash: hash,
    granted,
    enabled: true,
    approvedVersion: manifest.version,
    approvedPermissions: {
      required: [...manifest.permissions.required],
      optional: [...manifest.permissions.optional],
    },
    approvedFiles: Object.fromEntries(digests),
  };
}

/**
 * Builds the record for a Built-in Plugin's first sight: an untouched copy is
 * pre-granted, so every declared Plugin Permission (required and optional) is
 * granted and the shipped hash is recorded, but it starts disabled. A later
 * enable needs no review: every required grant is already present. A Built-in's
 * grants are listed and revocable like any other Plugin's (#442).
 */
export function approveBuiltInCopy(
  manifest: PluginManifest,
  hash: string,
  digests: ReadonlyMap<string, string>,
  shippedHash: string
): PluginApproval {
  const optionalGranted = manifest.permissions.optional as PluginPermissionId[];
  return {
    ...approvePluginCopy(manifest, hash, digests, optionalGranted),
    enabled: false,
    builtIn: { shippedHash },
  };
}

/**
 * Removes one Plugin Permission from the grants. Revoking a required one also
 * disables the Plugin; revoking an optional one leaves it enabled, and the
 * broker refuses the Plugin's next call because it reads `granted()` per call.
 */
export function revokePermission(
  approval: PluginApproval,
  permission: PluginPermissionId,
  manifest: PluginManifest
): PluginApproval {
  if (!approval.granted.includes(permission)) return approval;
  const granted = approval.granted.filter((current) => current !== permission);
  const required = manifest.permissions.required.includes(permission);
  return required ? { ...approval, granted, enabled: false } : { ...approval, granted };
}

/** Turns a Plugin off; it stays installed with its grants and data. */
export function disablePlugin(approval: PluginApproval): PluginApproval {
  return { ...approval, enabled: false };
}

/**
 * True when an approved copy no longer grants one of its required Plugin
 * Permissions, so it must be reviewed and re-approved before it can start.
 * Shared by the Settings row and the section's review wiring (#442).
 */
export function hasMissingRequired(
  entry: Pick<PluginManagementEntry, "approval" | "manifest">
): boolean {
  if (entry.approval === null) return false;
  return entry.manifest.permissions.required.some(
    (permission) => !entry.approval?.granted.includes(permission as PluginPermissionId)
  );
}

/**
 * Records a failed activation's startup error on the approval record, so
 * Settings shows the last failure until the Plugin starts again (#442). A
 * review state or an id the lifecycle never installed stores nothing.
 */
export function recordStartupError(pluginId: string, refusal: PluginActivationRefusal): void {
  const message = startupErrorValue(refusal);
  if (message === null) return;
  const approval = getPluginApproval(pluginId);
  if (!approval || approval.startupError === message) return;
  savePluginApproval({ ...approval, startupError: message });
}

/** Clears a stale startup error now that the Plugin started (#442). */
export function clearStartupError(pluginId: string): void {
  const approval = getPluginApproval(pluginId);
  if (!approval || approval.startupError === undefined) return;
  const cleared: PluginApproval = { ...approval };
  delete cleared.startupError;
  savePluginApproval(cleared);
}

/**
 * Turns a Plugin on, but only when every required Plugin Permission is still
 * granted. Otherwise it refuses and returns the record unchanged, so a required
 * gap must be reviewed and approved before the Plugin can start.
 */
export function enablePlugin(
  approval: PluginApproval,
  manifest: PluginManifest
): PluginEnableResult {
  const missing = manifest.permissions.required.filter(
    (permission) => !approval.granted.includes(permission as PluginPermissionId)
  );
  if (missing.length > 0) {
    return { ok: false, reason: "required-permissions-missing", missing, approval };
  }
  return { ok: true, approval: { ...approval, enabled: true } };
}
