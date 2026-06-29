import { IS_TAURI } from "@/lib/platform";
import { useSettingsStore } from "@/features/settings/store";
import { metricsService } from "@/lib/metrics/MetricsService";

let unlisten: (() => void) | null = null;

// The single window-close handler. Installed once at app startup (independent
// of metrics initialization) so close-to-tray works on a fresh launch and when
// metrics are disabled. When close-to-tray is on the window is hidden to the
// tray; otherwise metrics are flushed best-effort and the process exits.
export async function installWindowCloseHandler(): Promise<void> {
  if (
    !IS_TAURI ||
    unlisten ||
    typeof window === "undefined" ||
    !("__TAURI_INTERNALS__" in window)
  ) {
    return;
  }
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    unlisten = await win.onCloseRequested(async (event) => {
      event.preventDefault();
      if (useSettingsStore.getState().closeToTray) {
        await win.hide();
        return;
      }
      try {
        metricsService.endSession();
        await Promise.race([
          metricsService.flushNow(),
          new Promise<void>((resolve) => setTimeout(resolve, 200)),
        ]);
      } finally {
        // exit() terminates the process cleanly even with the tray icon
        // present; do not destroy() first or this context tears down before
        // exit can run.
        const { exit } = await import("@tauri-apps/plugin-process");
        await exit(0);
      }
    });
  } catch {
    // Not running inside a Tauri webview; nothing to install.
  }
}
