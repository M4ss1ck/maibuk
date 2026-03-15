import type { BackupEntry } from "../../lib/platform/types";

export function parseTriggerFromFilename(
  filename: string,
): BackupEntry["trigger"] {
  const match = filename.match(
    /^maibuk-backup-(launch|close|pre-sync|pre-restore|manual)-/,
  );

  return (match?.[1] as BackupEntry["trigger"]) ?? "unknown";
}
