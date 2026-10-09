import { useSyncExternalStore } from "react";
import { commandRegistryRevision, onCommandRegistryChange } from "@/lib/shortcut-registry";

export function useCommandRegistryRevision(): number {
  return useSyncExternalStore(
    onCommandRegistryChange,
    commandRegistryRevision,
    commandRegistryRevision
  );
}
