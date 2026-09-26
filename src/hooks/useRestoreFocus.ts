import { useEffect, useRef } from "react";

/**
 * Returns focus to whatever had it when `isOpen` turned true, once the
 * overlay closes or the component unmounts. Pass `getTarget` when the action
 * belongs to a control other than the opener (a dialog opened from another
 * dialog, whose opener is already gone): the target wins when it returns one.
 * `getTarget` is read again on close when the element it first returned is
 * gone, so an action that removes its own row can name the row that survived.
 *
 * The restore runs in a passive effect on purpose. React Aria's
 * useModalOverlay makes the rest of the page `inert` while open and lifts it
 * in a passive-effect cleanup; a layout-effect restore runs first, focuses an
 * inert element, and focus falls to <body>. Call this after useModalOverlay
 * so an unmount while open also lifts `inert` first. jsdom has no `inert`;
 * e2e/specs/books-create.spec.ts proves the timing in real browsers.
 */
export function useRestoreFocus(
  isOpen: boolean,
  {
    skipWhenDialogFocused = false,
    getTarget,
  }: { skipWhenDialogFocused?: boolean; getTarget?: () => HTMLElement | null } = {}
): void {
  const targetRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const openedRef = useRef(false);
  const skipRef = useRef(skipWhenDialogFocused);
  skipRef.current = skipWhenDialogFocused;
  const getTargetRef = useRef(getTarget);
  getTargetRef.current = getTarget;

  if (isOpen && !wasOpenRef.current && typeof document !== "undefined") {
    const provided = getTargetRef.current?.() ?? null;
    const activeElement = document.activeElement;
    targetRef.current =
      provided ?? (activeElement instanceof HTMLElement ? activeElement : null);
    openedRef.current = true;
  }
  wasOpenRef.current = isOpen;

  const restoreRef = useRef(() => {});
  restoreRef.current = () => {
    // Nothing was captured: the overlay never opened. The effect below also
    // runs on mount, where there is nothing to restore.
    if (!openedRef.current) {
      targetRef.current = null;
      return;
    }
    openedRef.current = false;
    // A dialog whose action removed the element captured on open resolves its
    // target again, so deleting a Note lands focus on the row that survived.
    let target = targetRef.current;
    if ((!target || !target.isConnected || target === document.body) && getTargetRef.current) {
      target = getTargetRef.current();
    }
    targetRef.current = null;
    if (!target?.isConnected || target === document.body) return;
    // Another dialog took focus meanwhile; leave it there.
    if (skipRef.current && document.activeElement?.closest?.('[role="dialog"]')) return;
    target.focus();
  };

  useEffect(() => {
    if (!isOpen) restoreRef.current();
  }, [isOpen]);

  useEffect(() => () => restoreRef.current(), []);
}
