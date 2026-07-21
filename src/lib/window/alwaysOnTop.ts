import { IS_DESKTOP, setWindowAlwaysOnTop } from "@/lib/platform";
import { useSettingsStore } from "@/features/settings/store";

let unlisten: (() => void) | null = null;

// Re-assert the always-on-top flag whenever the window regains focus. The OS
// window manager drops the "keep above" hint across a hide -> show cycle (close
// to tray then restore from the tray, taskbar, menu, or a re-launch), and the
// stored setting never changes on restore, so the AppSettingsProvider effect
// that normally applies it does not re-fire. Without this the flag is silently
// lost until the app is fully restarted, even though the toolbar still shows it
// as enabled. Installed once at startup.
export async function installAlwaysOnTopReapply(): Promise<void> {
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
    unlisten = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused || !useSettingsStore.getState().alwaysOnTop) {
        return;
      }
      void setWindowAlwaysOnTop(true).catch((error) => {
        console.error("Failed to re-apply always-on-top:", error);
      });
    });
  } catch {
    // Not running inside a Tauri webview; nothing to install.
  }
}
