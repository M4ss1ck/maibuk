import i18n from "i18next";
import { getDatabase } from "@/lib/db";
import { toast } from "@/components/ui/Toast";
import { isBulkSignal, isLibraryAvailability, onChange } from "@/features/sync/change-feed";
import { createBackup } from "@/lib/platform";
import { BackupService } from "@/features/backup/backup-service";
import { hasLaunchBackupSettled, onLaunchBackupSettled } from "@/features/backup/lifecycle";
import { useSettingsStore } from "@/features/settings/store";
import { isTutorialLibraryActive } from "@/features/tutorial/library-switch";
import {
  VERSION_FORMAT_INLINE,
  convertInlineVersions,
  deleteVersionRows,
} from "@/features/versions/content-store";
import { applyVersionRetention, withVersionWrites } from "@/features/versions/store";

// Brings Version storage up to ADR 0032/0033 on every launch, in the
// background. Each step is idempotent, so there is no marker to get wrong:
// a Library with no inline Versions left only gets Version Retention, and one
// restored from an old Backup is upgraded again. The space comes back when
// compactLibrary runs on the next open.

/** Inline Versions converted per transaction, so the Library is never locked for long. */
export const UPGRADE_BATCH_SIZE = 10;

async function createSafetyBackup(): Promise<void> {
  const { backupDirectory } = useSettingsStore.getState();
  const service = new BackupService(await createBackup(backupDirectory));
  await service.createBackup("pre-restore");
}

/** The safety Backup failed, so nothing was pruned or converted. */
export class UpgradeBackupError extends Error {
  constructor(readonly cause: unknown) {
    super("Version storage upgrade needs a safety Backup first");
    this.name = "UpgradeBackupError";
  }
}

export interface UpgradeResult {
  dropped: number;
  converted: number;
}

export async function upgradeVersionStorage(
  safetyBackup: () => Promise<void> = createSafetyBackup
): Promise<UpgradeResult> {
  // No Version is ever kept of the Tutorial Library (ADR 0008).
  if (isTutorialLibraryActive()) return { dropped: 0, converted: 0 };
  const db = await getDatabase();

  const legacy = await db.select<{ id: string }[]>(
    "SELECT id FROM book_versions WHERE format = ? LIMIT 1",
    [VERSION_FORMAT_INLINE]
  );
  // The first upgrade deletes history it cannot bring back, so a Backup comes
  // first; if it fails, nothing is touched and the next launch tries again.
  if (legacy.length > 0) {
    try {
      await safetyBackup();
    } catch (error) {
      throw new UpgradeBackupError(error);
    }
  }

  let dropped = 0;
  const orphans = await db.select<{ id: string }[]>(
    "SELECT id FROM book_versions WHERE NOT EXISTS (SELECT 1 FROM books b WHERE b.id = book_versions.book_id)"
  );
  if (orphans.length > 0) {
    await withVersionWrites(() =>
      deleteVersionRows(
        db,
        orphans.map((row) => row.id)
      )
    );
    dropped += orphans.length;
  }

  const books = await db.select<{ book_id: string }[]>(
    "SELECT DISTINCT book_id FROM book_versions"
  );
  for (const { book_id } of books) {
    dropped += (
      await withVersionWrites(() =>
        applyVersionRetention(db, book_id, undefined, { upgrading: true })
      )
    ).length;
  }

  let converted = 0;
  for (;;) {
    const batch = await withVersionWrites(() => convertInlineVersions(db, UPGRADE_BATCH_SIZE));
    if (batch === 0) break;
    converted += batch;
  }

  if (dropped > 0 || converted > 0) {
    console.info(`[versions] upgrade dropped ${dropped} and converted ${converted} Version(s)`);
  }
  return { dropped, converted };
}

let upgradeRunning = false;
let upgradeRequested = false;
let currentUpgrade: Promise<void> = Promise.resolve();

/**
 * Single-flight: a request that lands while an upgrade runs (a Restore in the
 * middle of it) runs once more after it, so restored Versions are not left
 * until the next launch.
 */
function runUpgrade(): void {
  if (upgradeRunning) {
    upgradeRequested = true;
    return;
  }
  upgradeRunning = true;
  upgradeRequested = false;
  currentUpgrade = upgradeVersionStorage()
    .catch((error: unknown) => {
      console.warn(
        "[versions] upgrade failed; it runs again next launch or after a Restore",
        error
      );
      // Until a safety Backup succeeds, history is neither pruned nor synced;
      // the author has to know, or the Library stays large without a sign.
      if (error instanceof UpgradeBackupError) toast.error(i18n.t("versions.upgradeBackupFailed"));
    })
    .then(() => {
      upgradeRunning = false;
      if (upgradeRequested) runUpgrade();
    });
}

/** Resolves once no upgrade runs and none is queued; tests await it so no run leaks into the next test. */
export async function settleVersionStorageUpgradeForTests(): Promise<void> {
  while (upgradeRunning) await currentUpgrade;
}

/**
 * Runs the upgrade after the launch Backup, so they never compete, and again
 * whenever old Versions can have come back: a Restore, a loaded Database File,
 * a Reset, or the author's Library returning after the Tutorial. Returns a
 * function that stops listening.
 */
export function scheduleVersionStorageUpgrade(): () => void {
  let stopListening = (): void => {};
  const start = (): void => {
    runUpgrade();
    stopListening = onChange((signal) => {
      if (isBulkSignal(signal) || (isLibraryAvailability(signal) && signal.available)) {
        runUpgrade();
      }
    });
  };
  if (hasLaunchBackupSettled()) {
    start();
    return () => stopListening();
  }
  const stopWaiting = onLaunchBackupSettled(() => {
    stopWaiting();
    start();
  });
  return () => {
    stopWaiting();
    stopListening();
  };
}
