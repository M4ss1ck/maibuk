import { IS_DESKTOP } from "@/lib/platform";
import { useSettingsStore } from "@/features/settings/store";
import { runShutdown } from "@/lib/window/shutdown";

let unlisten: (() => void) | null = null;

// The single window-close handler. Installed once at app startup (independent
// of metrics initialization) so close-to-tray works on a fresh launch and when
// metrics are disabled. When close-to-tray is on the window is hidden to the
// tray; otherwise the shutdown routine runs and the process exits.
export async function installWindowCloseHandler(): Promise<void> {
  if (
    !IS_DESKTOP ||
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
      await runShutdown("exit");
    });
  } catch {
    // Not running inside a Tauri webview; nothing to install.
  }
}
