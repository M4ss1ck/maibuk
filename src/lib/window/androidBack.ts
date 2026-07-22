import type { PluginListener } from "@tauri-apps/api/core";
import { IS_ANDROID } from "@/lib/platform";
import { runTopBackDismiss } from "@/lib/platform/backDismiss";

let backButtonListener: PluginListener | null = null;

// On Android, route the hardware back button through the LIFO dismiss registry
// first; if nothing is dismissible, step back through router history; only when
// at a root surface with empty history do we let the app exit.
export async function installAndroidBackHandler(): Promise<void> {
  if (!IS_ANDROID || backButtonListener || typeof window === "undefined") return;
  try {
    const { onBackButtonPress } = await import("@tauri-apps/api/app");
    backButtonListener = await onBackButtonPress(async () => {
      if (runTopBackDismiss()) return;
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(0);
    });
  } catch {
    // Not inside a Tauri Android webview; nothing to install.
  }
}
