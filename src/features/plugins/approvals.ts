/**
 * Device-local Plugin approvals: the folder hash the author pinned and the
 * Plugin Permissions they granted. The install and permission flow (#442)
 * writes these records; until it lands, only the E2E `prepareDevice` seed
 * writes them, so no user-reachable path installs a Plugin. Approvals are
 * device-local: never synced, never in a Backup.
 */

import type { PluginApproval } from "@/features/plugins/types";

export const PLUGIN_APPROVALS_STORAGE_KEY = "maibuk-plugins";

interface StoredApprovals {
  version: 1;
  approvals: PluginApproval[];
}

function isApproval(value: unknown): value is PluginApproval {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.pluginId === "string" &&
    typeof record.pinnedHash === "string" &&
    Array.isArray(record.granted) &&
    record.granted.every((permission) => typeof permission === "string")
  );
}

function read(): PluginApproval[] {
  try {
    const raw = localStorage.getItem(PLUGIN_APPROVALS_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return [];
    const approvals = (parsed as Partial<StoredApprovals>).approvals;
    if (!Array.isArray(approvals)) return [];
    return approvals.filter(isApproval);
  } catch {
    return [];
  }
}

function write(approvals: PluginApproval[]): void {
  localStorage.setItem(PLUGIN_APPROVALS_STORAGE_KEY, serializePluginApprovals(approvals));
}

/** The record shape both the app and the E2E seed write. */
export function serializePluginApprovals(approvals: PluginApproval[]): string {
  return JSON.stringify({ version: 1, approvals } satisfies StoredApprovals);
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
