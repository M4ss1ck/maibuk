import { runBackgroundBackup } from "@/features/backup/lifecycle";
import { metricsService } from "@/lib/metrics/MetricsService";
import { IS_ANDROID } from "@/lib/platform";

const THROTTLE_MS = 30_000;
let lastBackgroundAt: number | null = null;
let installed = false;

// Exported for tests: perform the background flush + throttled backup.
export async function handleBackground(now: number = Date.now()): Promise<void> {
  if (lastBackgroundAt !== null && now - lastBackgroundAt < THROTTLE_MS) return;
  lastBackgroundAt = now;
  metricsService.endSession();
  await Promise.race([
    metricsService.flushNow(),
    new Promise<void>((resolve) => setTimeout(resolve, 200)),
  ]);
  await runBackgroundBackup();
}

export async function installAndroidLifecycleHandler(): Promise<void> {
  if (!IS_ANDROID || installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void handleBackground();
  });
}

export function resetAndroidLifecycleForTests(): void {
  lastBackgroundAt = null;
  installed = false;
}
