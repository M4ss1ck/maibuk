import type { BackupEntry } from "@/lib/platform/types";

export function parseTriggerFromFilename(filename: string): BackupEntry["trigger"] {
  const match = filename.match(/^maibuk-backup-(daily|pre-sync|pre-restore|manual|close)-/);

  return (match?.[1] as BackupEntry["trigger"]) ?? "unknown";
}

const backupDateFormatters = new Map<string, Intl.DateTimeFormat>();

/** MM/DD/YYYY (en) or DD/MM/YYYY (es), always 12-hour time with seconds. */
export function formatBackupDate(date: Date, language: string): string {
  let formatter = backupDateFormatters.get(language);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
    backupDateFormatters.set(language, formatter);
  }
  return formatter.format(date);
}

const WINDOWS_ABSOLUTE = /^([a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i;

function isWindowsPath(path: string): boolean {
  return WINDOWS_ABSOLUTE.test(path);
}

/**
 * Whether a typed Backup Directory is absolute. `~` and relative paths would
 * resolve against the app's working directory, not what the author means.
 */
export function isAbsoluteDirectoryPath(path: string): boolean {
  return path.startsWith("/") || isWindowsPath(path);
}

function normalizeDirectory(path: string): string {
  const trimmed = path.trim();
  if (!isWindowsPath(trimmed)) return trimmed.replace(/\/+$/, "") || "/";
  // Windows paths ignore case and accept either separator.
  return trimmed
    .replace(/\//g, "\\")
    .replace(/(?<!^[a-z]:)\\+$/i, "")
    .toLowerCase();
}

/** Same folder despite a trailing separator, or letter case on Windows. */
export function isSameDirectory(a: string, b: string): boolean {
  return normalizeDirectory(a) === normalizeDirectory(b);
}
