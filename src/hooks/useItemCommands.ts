import { useSyncExternalStore, type RefObject } from "react";
import { useShortcuts } from "@/lib/shortcuts";
import type { CommandId } from "@/lib/shortcut-registry";

export interface ItemCommand {
  commandId?: CommandId;
  isDisabled?: boolean;
  onAction?: () => void;
  children?: ItemCommand[];
}

const focusListeners = new Set<() => void>();

function notifyFocusListeners() {
  for (const listener of focusListeners) listener();
}

function onFocusOut() {
  // focusout fires before the next element takes focus; read it once focus settles.
  queueMicrotask(notifyFocusListeners);
}

/**
 * One document focus listener pair shared by every mounted item row. A long
 * list costs one listener, not one per row (issue #550). Each row's snapshot
 * is a boolean, so useSyncExternalStore re-renders only rows whose focus
 * state changed.
 */
function subscribeToFocus(listener: () => void): () => void {
  if (focusListeners.size === 0) {
    document.addEventListener("focusin", notifyFocusListeners);
    document.addEventListener("focusout", onFocusOut);
  }
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
    if (focusListeners.size === 0) {
      document.removeEventListener("focusin", notifyFocusListeners);
      document.removeEventListener("focusout", onFocusOut);
    }
  };
}

/**
 * Whether focus is on the element or inside it; only reads focus, never moves
 * it. The ref is read at snapshot time, not captured once, because a React
 * Aria collection item renders twice (a hidden pass that builds the
 * collection, then the visible one) and the ref only reaches the visible DOM
 * after this effect has run.
 */
function useFocusInside(ref: RefObject<HTMLElement | null>): boolean {
  return useSyncExternalStore(
    subscribeToFocus,
    () => {
      const element = ref.current;
      return element !== null && element.contains(document.activeElement);
    },
    () => false
  );
}

/**
 * Runs an item's Item Menu actions from their Commands' Shortcuts while focus
 * is inside that item (a Note row, a Chapter, a Canvas node). Nothing listens
 * for items without focus, so a long list costs one binding, not one per row.
 * Submenu children bind too: a value the menu reaches by opening a submenu is
 * still a Command the item's Shortcut can run.
 */
export function useItemCommands(
  ref: RefObject<HTMLElement | null>,
  actions: readonly ItemCommand[],
  { enabled = true }: { enabled?: boolean } = {}
): void {
  const focused = useFocusInside(ref);
  const bindings = actions.flatMap((action) => collectBindings(action));
  useShortcuts(bindings, { enabled: enabled && focused });
}

function collectBindings(action: ItemCommand): {
  id: CommandId;
  enabled: boolean;
  onTrigger: () => void;
}[] {
  if (action.children && action.children.length > 0) {
    return action.children.flatMap((child) => collectBindings(child));
  }
  if (action.commandId && action.onAction && !action.children) {
    return [
      {
        id: action.commandId,
        enabled: !action.isDisabled,
        onTrigger: () => action.onAction?.(),
      },
    ];
  }
  return [];
}
