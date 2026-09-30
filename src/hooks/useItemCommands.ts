import { useEffect, useState, type RefObject } from "react";
import { useShortcuts } from "@/lib/shortcuts";
import type { CommandId } from "@/lib/shortcut-registry";

export interface ItemCommand {
  commandId?: CommandId;
  isDisabled?: boolean;
  onAction?: () => void;
  children?: ItemCommand[];
}

/** Whether focus is on the element or inside it; only reads focus, never moves it. */
function useFocusInside(ref: RefObject<HTMLElement | null>): boolean {
  const [inside, setInside] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setInside(element.contains(element.ownerDocument.activeElement));
    update();
    // focusout fires before the next element takes focus; read it once focus settles.
    const onFocusOut = () => queueMicrotask(update);
    element.addEventListener("focusin", update);
    element.addEventListener("focusout", onFocusOut);
    return () => {
      element.removeEventListener("focusin", update);
      element.removeEventListener("focusout", onFocusOut);
    };
  }, [ref]);
  return inside;
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
