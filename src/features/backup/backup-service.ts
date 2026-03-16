import type { BackupAdapter, BackupEntry, DatabaseAdapter } from "../../lib/platform/types";
import { getDatabase } from "../../lib/db";
import { parseSqlStatements } from "../../lib/db/sql-parser";
import { useBookStore } from "../books/store";
import { useChapterStore } from "../chapters/store";
import { generateSqlDump } from "./generate-sql-dump";

function buildFilename(trigger: BackupEntry["trigger"]): string {
  const now = new Date();
  const ts = now.toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "");
  return `maibuk-backup-${trigger}-${ts}.sql`;
}

const PROTECTED_TRIGGERS = new Set<BackupEntry["trigger"]>(["pre-sync", "pre-restore"]);
const MIN_PROTECTED = 2;
/**
 * Filter to only allow restore INSERT statements targeting books and chapters.
 * Multi-statement injection is blocked by `parseSqlStatements()` splitting on
 * unquoted semicolons, and this regex requires a concrete VALUES clause.
 */
const RESTORE_TABLE_PATTERN = /^INSERT\s+(OR\s+REPLACE\s+)?INTO\s+"?(books|chapters)"?\s*(\([^)]*\)\s*)?VALUES\s*\(/i;

function isRestoreStatement(statement: string): boolean {
  return RESTORE_TABLE_PATTERN.test(statement.trim());
}

function extractRestoreStatements(sql: string): string[] {
  return parseSqlStatements(sql).filter(isRestoreStatement);
}

const INSERT_PATTERN = /^INSERT\s/i;

function dumpHasData(sql: string): boolean {
  return parseSqlStatements(sql).some((s) => INSERT_PATTERN.test(s.trim()));
}

async function replaceRestoreData(
  db: DatabaseAdapter,
  statements: string[],
): Promise<void> {
  // Delete existing data first, then insert from backup.
  // Each statement is auto-committed. If an INSERT fails, the database
  // will be in a partial state — the pre-restore backup is the safety net.
  await db.execute("DELETE FROM chapters");
  await db.execute("DELETE FROM books");

  for (let i = 0; i < statements.length; i++) {
    try {
      await db.execute(statements[i]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Restore failed on statement ${i + 1}/${statements.length}: ${detail}`,
      );
    }
  }
}

export class BackupService {
  constructor(private adapter: BackupAdapter) { }

  private async saveBackupSnapshot(
    trigger: BackupEntry["trigger"],
    sql: string,
  ): Promise<string> {
    const filename = buildFilename(trigger);
    await this.adapter.saveBackup(filename, sql);
    return filename;
  }

  async createBackup(trigger: BackupEntry["trigger"]): Promise<string> {
    const sql = await generateSqlDump();
    if (!dumpHasData(sql)) {
      throw new Error("BACKUP_EMPTY");
    }
    return this.saveBackupSnapshot(trigger, sql);
  }

  /** Returns true if a backup with the given trigger already exists for today (UTC date). */
  async hasBackupForToday(trigger: BackupEntry["trigger"]): Promise<boolean> {
    const list = await this.adapter.listBackups();
    const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    return list.some(
      (entry) =>
        entry.trigger === trigger &&
        entry.createdAt.toISOString().slice(0, 10) === todayStr,
    );
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

  async restoreBackup(filename: string): Promise<void> {
    const currentSql = await generateSqlDump();
    if (dumpHasData(currentSql)) {
      await this.saveBackupSnapshot("pre-restore", currentSql);
    }

    let sql: string;
    try {
      // Adapter-level reads enforce checksum verification before SQL content is
      // returned, so corrupted backups fail here before any restore work begins.
      sql = await this.adapter.readBackup(filename);
    } catch {
      throw new Error("BACKUP_CORRUPT");
    }

    const statements = extractRestoreStatements(sql);
    if (statements.length === 0) {
      throw new Error("RESTORE_INVALID");
    }

    const db = await getDatabase();

    try {
      await replaceRestoreData(db, statements);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("Restore data replacement failed:", detail);
      throw new Error(`RESTORE_FAILED: ${detail}`);
    }

    await useBookStore.getState().loadBooks();
    const previousBookId = useChapterStore.getState().currentBookId;
    const restoredBooks = useBookStore.getState().books;
    const currentBookStillExists = previousBookId
      ? restoredBooks.some((book) => book.id === previousBookId)
      : false;

    if (currentBookStillExists && previousBookId) {
      await useChapterStore.getState().loadChapters(previousBookId);
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

  async deleteByTrigger(trigger: BackupEntry["trigger"]): Promise<void> {
    const list = await this.adapter.listBackups();
    for (const entry of list) {
      if (entry.trigger === trigger) {
        await this.adapter.deleteBackup(entry.filename);
      }
    }
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
