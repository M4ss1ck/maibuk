import { useEffect, useState, type RefObject } from "react";
import { useShortcuts } from "@/lib/shortcuts";
import type { CommandId } from "@/lib/shortcut-registry";

export interface ItemCommand {
  commandId?: CommandId;
  isDisabled?: boolean;
  onAction?: () => void;
  children?: unknown[];
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
 */
export function useItemCommands(
  ref: RefObject<HTMLElement | null>,
  actions: readonly ItemCommand[],
  { enabled = true }: { enabled?: boolean } = {}
): void {
  const focused = useFocusInside(ref);
  const bindings = actions.flatMap((action) =>
    action.commandId && action.onAction && !action.children
      ? [
          {
            id: action.commandId,
            enabled: !action.isDisabled,
            onTrigger: () => action.onAction?.(),
          },
        ]
      : []
  );
  useShortcuts(bindings, { enabled: enabled && focused });
}
