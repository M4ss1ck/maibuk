import { useSyncExternalStore } from "react";
import { commandRegistryRevision, onCommandRegistryChange } from "@/lib/shortcut-registry";

/**
 * Re-renders when a Plugin registers or unregisters its Commands, so a live
 * list (the Shortcut Editor, the shortcut help) follows the registry.
 */
export function useCommandRegistryRevision(): number {
  return useSyncExternalStore(
    onCommandRegistryChange,
    commandRegistryRevision,
    commandRegistryRevision
  );
}
