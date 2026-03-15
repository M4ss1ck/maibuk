import type { BackupAdapter, BackupEntry } from "../../lib/platform/types";
import { generateSqlDump } from "./generate-sql-dump";
import { computeChecksum } from "../sync/crypto";

function buildFilename(trigger: BackupEntry["trigger"]): string {
  const now = new Date();
  const ts = now.toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "");
  return `maibuk-backup-${trigger}-${ts}.sql`;
}

const PROTECTED_TRIGGERS = new Set<BackupEntry["trigger"]>(["pre-sync", "pre-restore"]);
const MIN_PROTECTED = 2;

export class BackupService {
  constructor(private adapter: BackupAdapter) {}

  async createBackup(trigger: BackupEntry["trigger"]): Promise<string> {
    const sql = await generateSqlDump();
    const checksum = await computeChecksum(sql);
    const filename = buildFilename(trigger);
    await this.adapter.saveBackup(filename, sql, trigger, checksum);
    return filename;
  }

  async listBackups(): Promise<BackupEntry[]> {
    return this.adapter.listBackups();
  }

  async readBackup(filename: string): Promise<string> {
    return this.adapter.readBackup(filename);
  }

  async deleteBackup(filename: string): Promise<void> {
    return this.adapter.deleteBackup(filename);
  }

  async verifyBackup(filename: string): Promise<boolean> {
    const sql = await this.adapter.readBackup(filename);
    const list = await this.adapter.listBackups();
    const entry = list.find((e) => e.filename === filename);
    if (!entry) return false;

    const actual = await computeChecksum(sql);
    return actual === entry.checksum;
  }

  async pruneBackups(maxCount: number): Promise<void> {
    const list = await this.adapter.listBackups();
    if (list.length <= maxCount) return;

    // Count per trigger type
    const triggerCounts = new Map<string, number>();
    for (const entry of list) {
      triggerCounts.set(entry.trigger, (triggerCounts.get(entry.trigger) ?? 0) + 1);
    }

    // Sort oldest first for deletion candidates
    const oldest = [...list].reverse();
    let toDelete = list.length - maxCount;

    for (const entry of oldest) {
      if (toDelete <= 0) break;

      const count = triggerCounts.get(entry.trigger) ?? 0;

      // Protect pre-sync and pre-restore (keep at least MIN_PROTECTED each)
      if (PROTECTED_TRIGGERS.has(entry.trigger) && count <= MIN_PROTECTED) continue;

      // Prefer deleting from most-represented trigger type
      const maxTriggerCount = Math.max(...triggerCounts.values());
      if (count < maxTriggerCount) continue;

      await this.adapter.deleteBackup(entry.filename);
      triggerCounts.set(entry.trigger, count - 1);
      toDelete--;
    }

    // Second pass: if still over limit, delete any eligible backup (oldest first)
    if (toDelete > 0) {
      const remaining = await this.adapter.listBackups();
      const remainingOldest = [...remaining].reverse();
      const remainingCounts = new Map<string, number>();
      for (const entry of remaining) {
        remainingCounts.set(entry.trigger, (remainingCounts.get(entry.trigger) ?? 0) + 1);
      }
      for (const entry of remainingOldest) {
        if (toDelete <= 0) break;
        if (PROTECTED_TRIGGERS.has(entry.trigger) && (remainingCounts.get(entry.trigger) ?? 0) <= MIN_PROTECTED) continue;
        await this.adapter.deleteBackup(entry.filename);
        remainingCounts.set(entry.trigger, (remainingCounts.get(entry.trigger) ?? 0) - 1);
        toDelete--;
      }
    }
  }
}
