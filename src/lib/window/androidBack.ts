import type { PluginListener } from "@tauri-apps/api/core";
import { IS_ANDROID } from "@/lib/platform";
import { runTopBackDismiss } from "@/lib/platform/backDismiss";

let backButtonListener: PluginListener | null = null;
let installing = false;
let upNavigator: ((to: string) => void) | null = null;

// Chromium marks history entries created without user activation as skippable,
// so the WebView reports canGoBack:false after a startup restore even though the
// app is on a deep route. Deriving the parent from the route keeps Back working
// there instead of exiting the app.
export function registerBackUpNavigator(navigateTo: (to: string) => void): () => void {
  upNavigator = navigateTo;
  return () => {
    if (upNavigator === navigateTo) upNavigator = null;
  };
}

export function parentRouteOf(path: string): string | null {
  const cover = path.match(/^(\/book\/[^/]+)\/cover$/);
  if (cover) return cover[1];
  if (/^\/book\/[^/]+$/.test(path)) return "/";
  const child = path.match(/^(\/(?:notes|canvas))\/[^/]+$/);
  if (child) return child[1];
  return null;
}

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
      const parent = parentRouteOf(window.location.pathname);
      if (parent && upNavigator) {
        upNavigator(parent);
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
