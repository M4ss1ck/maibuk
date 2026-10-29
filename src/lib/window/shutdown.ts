import { whenBackupQueueIdle } from "@/features/backup/backup-service";
import { useSyncStore } from "@/features/sync/store";
import { flushPendingEdits } from "@/features/sync/pending-edits";
import { deactivateTutorialDatabase } from "@/features/tutorial/library-switch";
import { metricsService } from "@/lib/metrics/MetricsService";

export type ShutdownMode = "exit" | "restart";

export interface ShutdownSteps {
  leaveTutorial(): void;
  flushEdits(): Promise<void>;
  /** Resolves when no Backup or Sync is running. May take as long as it likes; the routine cuts it off. */
  settleBackgroundWork(): Promise<void>;
  flushMetrics(): Promise<void>;
  exit(): Promise<void>;
  restart(): Promise<void>;
  settleLimitMs: number;
}

const SETTLE_LIMIT_MS = 3000;
const METRICS_LIMIT_MS = 200;

function within(work: Promise<void>, ms: number): Promise<void> {
  return Promise.race([
    work.catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);
}

async function waitForSync(): Promise<void> {
  if (useSyncStore.getState().syncStatus !== "syncing") return;
  await new Promise<void>((resolve) => {
    const unsubscribe = useSyncStore.subscribe((state) => {
      if (state.syncStatus === "syncing") return;
      unsubscribe();
      resolve();
    });
  });
}

const defaultSteps: ShutdownSteps = {
  leaveTutorial: deactivateTutorialDatabase,
  flushEdits: flushPendingEdits,
  async settleBackgroundWork() {
    await Promise.all([whenBackupQueueIdle(), waitForSync()]);
  },
  async flushMetrics() {
    metricsService.endSession();
    await metricsService.flushNow();
  },
  async exit() {
    // exit() terminates the process cleanly even with the tray icon present;
    // do not destroy() first or this context tears down before exit can run.
    const { exit } = await import("@tauri-apps/plugin-process");
    await exit(0);
  },
  async restart() {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  },
  settleLimitMs: SETTLE_LIMIT_MS,
};

/**
 * The one way the app ends: window close (close-to-tray off), Restart now.
 * Leaves the Tutorial Library first so the work below lands in the author's
 * Library, Flushes the open Edit Session, gives a running Backup or Sync a
 * bounded moment, Flushes metrics, then exits or restarts.
 *
 * On close, a Flush that fails does not trap the window open. On restart it
 * stops everything, so the author keeps writing in the editor that still holds
 * the text.
 */
export async function runShutdown(
  mode: ShutdownMode,
  steps: ShutdownSteps = defaultSteps
): Promise<void> {
  steps.leaveTutorial();
  try {
    await steps.flushEdits();
  } catch (error) {
    if (mode === "restart") throw error;
    console.warn("Edit Session not saved before exit", error);
  }
  await within(steps.settleBackgroundWork(), steps.settleLimitMs);
  await within(steps.flushMetrics(), METRICS_LIMIT_MS);
  await (mode === "restart" ? steps.restart() : steps.exit());
}
