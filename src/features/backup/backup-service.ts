import type { BackupAdapter, BackupEntry } from "../../lib/platform/types";
import { getDatabase } from "../../lib/db";
import { parseSqlStatements } from "../../lib/db/sql-parser";
import { useBookStore } from "../books/store";
import { useChapterStore } from "../chapters/store";
import { generateSqlDump } from "./generate-sql-dump";
import { computeChecksum } from "../sync/crypto";

function buildFilename(trigger: BackupEntry["trigger"]): string {
  const now = new Date();
  const ts = now.toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "");
  return `maibuk-backup-${trigger}-${ts}.sql`;
}

const PROTECTED_TRIGGERS = new Set<BackupEntry["trigger"]>(["pre-sync", "pre-restore"]);
const MIN_PROTECTED = 2;
const RESTORE_TABLE_PATTERN = /^INSERT\s+INTO\s+"?(books|chapters)"?/i;

function isRestoreStatement(statement: string): boolean {
  return RESTORE_TABLE_PATTERN.test(statement.trim());
}

export class BackupService {
  constructor(private adapter: BackupAdapter) { }

  async createBackup(trigger: BackupEntry["trigger"]): Promise<string> {
    const sql = await generateSqlDump();
    const filename = buildFilename(trigger);
    await this.adapter.saveBackup(filename, sql);
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

  async restoreBackup(filename: string): Promise<void> {
    await this.createBackup("pre-restore");

    let sql: string;
    try {
      sql = await this.adapter.readBackup(filename);
    } catch {
      throw new Error("BACKUP_CORRUPT");
    }

    const statements = parseSqlStatements(sql).filter(isRestoreStatement);
    if (statements.length === 0) {
      throw new Error("RESTORE_INVALID");
    }

    const db = await getDatabase();
    await db.execute("BEGIN");

    try {
      await db.execute("DELETE FROM chapters");
      await db.execute("DELETE FROM books");

      for (const statement of statements) {
        await db.execute(statement);
      }

      await db.execute("COMMIT");
    } catch {
      await db.execute("ROLLBACK").catch(() => undefined);
      throw new Error("RESTORE_FAILED");
    }

    await useBookStore.getState().loadBooks();
    const firstBookId = useBookStore.getState().books[0]?.id ?? null;

    if (firstBookId) {
      await useChapterStore.getState().loadChapters(firstBookId);
      return;
    }

    useChapterStore.setState({
      chapters: [],
      currentChapter: null,
      currentBookId: null,
      isLoading: false,
      error: null,
    });
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
