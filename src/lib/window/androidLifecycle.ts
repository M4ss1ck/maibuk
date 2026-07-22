import { runBackgroundBackup } from "@/features/backup/lifecycle";
import { metricsService } from "@/lib/metrics/MetricsService";
import { IS_ANDROID } from "@/lib/platform";

const THROTTLE_MS = 30_000;
let lastBackgroundAt: number | null = null;
let installed = false;
let inFlight: Promise<void> | null = null;
let visibilityHandler: (() => void) | null = null;

// Exported for tests: perform the background flush + throttled backup.
export async function handleBackground(now: number = Date.now()): Promise<void> {
  if (inFlight) return inFlight;
  if (lastBackgroundAt !== null && now - lastBackgroundAt < THROTTLE_MS) return;
  lastBackgroundAt = now;
  const work = Promise.resolve().then(async () => {
    try {
      metricsService.endSession();
      await Promise.race([
        metricsService.flushNow(),
        new Promise<void>((resolve) => setTimeout(resolve, 200)),
      ]);
    } catch (error) {
      console.warn("Failed to flush background metrics:", error);
    }
    await runBackgroundBackup();
  });
  inFlight = work;
  try {
    await work;
  } finally {
    if (inFlight === work) inFlight = null;
  }
}

export async function installAndroidLifecycleHandler(): Promise<void> {
  if (!IS_ANDROID || installed || typeof document === "undefined") return;
  installed = true;
  visibilityHandler = () => {
    if (document.visibilityState === "hidden") void handleBackground();
  };
  document.addEventListener("visibilitychange", visibilityHandler);
}

export function resetAndroidLifecycleForTests(): void {
  if (visibilityHandler && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", visibilityHandler);
  }
  lastBackgroundAt = null;
  installed = false;
  inFlight = null;
  visibilityHandler = null;
}
