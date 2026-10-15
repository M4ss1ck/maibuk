import { useEffect, useState } from "react";
import { getPluginSecretStore } from "@/features/plugins/secret-store";

/** The saved-credential state one Plugin row shows. */
export interface PluginSecrets {
  /**
   * True when the registered store can persist credentials on this device, so
   * the row offers the "remember on this device" switch.
   */
  canRemember: boolean;
  /** This Plugin's saved credential names, names only, sorted. */
  names: string[];
  /** True while the store remembers this Plugin's credentials on this device. */
  remembered: boolean;
  /** Turns "remember on this device" on or off for this Plugin. */
  setRemembered(on: boolean): void;
}

/**
 * Reads one Plugin's saved-credential state from the registered store, so a row
 * shows the real state rather than the secrets grant. `active` re-reads the
 * names when the row opens, the way the data-size read does.
 */
export function usePluginSecrets(pluginId: string, active = true): PluginSecrets {
  const store = getPluginSecretStore();
  const canRemember = typeof store?.setRemembered === "function";
  const [names, setNames] = useState<string[]>([]);
  const [remembered, setRememberedState] = useState<boolean>(() =>
    canRemember ? store?.isRemembered?.(pluginId) === true : false
  );

  useEffect(() => {
    if (!active || !store) return;
    let live = true;
    // Re-read the remember flag beside the names: a store registered after the
    // first render, or a row reopened later, must show the true state.
    setRememberedState(store.isRemembered?.(pluginId) === true);
    void Promise.resolve(store.listNames(pluginId))
      .then((next) => {
        if (live) setNames(next);
      })
      .catch(() => {
        if (live) setNames([]);
      });
    return () => {
      live = false;
    };
  }, [store, pluginId, active]);

  function setRemembered(on: boolean): void {
    if (!store?.setRemembered) return;
    setRememberedState(on);
    void Promise.resolve(store.setRemembered(pluginId, on)).catch(() => {});
  }

  return { canRemember, names, remembered, setRemembered };
}
