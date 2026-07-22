import type { PluginListener } from "@tauri-apps/api/core";
import { IS_ANDROID } from "@/lib/platform";
import { runTopBackDismiss } from "@/lib/platform/backDismiss";

let backButtonListener: PluginListener | null = null;
let installing = false;

// On Android, route the hardware back button through the LIFO dismiss registry
// first; if nothing is dismissible, step back through router history; only when
// at a root surface with empty history do we let the app exit.
export async function installAndroidBackHandler(): Promise<void> {
  if (!IS_ANDROID || backButtonListener || installing || typeof window === "undefined") return;
  installing = true;
  try {
    const { onBackButtonPress } = await import("@tauri-apps/api/app");
    backButtonListener = await onBackButtonPress(async ({ canGoBack }) => {
      if (runTopBackDismiss()) return;
      if (canGoBack) {
        window.history.back();
        return;
      }
      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(0);
    });
  } catch {
    // Not inside a Tauri Android webview; nothing to install.
  } finally {
    installing = false;
  }
}
