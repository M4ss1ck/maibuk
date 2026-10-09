import { useSyncExternalStore } from "react";
import {
  onToolbarRegistryChange,
  toolbarRegistryRevision,
} from "@/features/settings/toolbar-config";

export function useToolbarRegistryRevision(): number {
  return useSyncExternalStore(
    onToolbarRegistryChange,
    toolbarRegistryRevision,
    toolbarRegistryRevision
  );
}
