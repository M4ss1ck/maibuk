import { useSyncStore } from "@/features/sync/store";
import { AUTH_CHECK_INTERVAL_MS } from "@/features/sync/auth-policy";

let uninstall: (() => void) | null = null;

/**
 * Keep the sync session alive while the app runs. Launch-time verification
 * alone let the token lapse when the app stayed open (tray, sleep) for longer
 * than the token lifetime, or when launch happened offline. Re-evaluates the
 * refresh policy on a timer and whenever the app plausibly came back: network
 * reconnect, window focus, tab/window becoming visible. Idempotent; returns an
 * uninstaller.
 */
export function installAuthKeepAlive(): () => void {
  if (uninstall) return uninstall;

  const check = () => {
    void useSyncStore.getState().keepSessionAlive();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") check();
  };

  const timer = setInterval(check, AUTH_CHECK_INTERVAL_MS);
  window.addEventListener("online", check);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", onVisibilityChange);

  uninstall = () => {
    clearInterval(timer);
    window.removeEventListener("online", check);
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    uninstall = null;
  };
  return uninstall;
}
