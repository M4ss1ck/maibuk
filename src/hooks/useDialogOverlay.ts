import { useEffect, type RefObject } from "react";
import { useOverlay, usePreventScroll } from "react-aria";
import { hideOutsidePortal } from "@/lib/hide-outside";

interface DialogOverlayOptions {
  isOpen: boolean;
  onClose: () => void;
  /** The dialog's panel, the element the overlay portal contains. */
  ref: RefObject<HTMLElement | null>;
  isDismissable?: boolean;
  isKeyboardDismissDisabled?: boolean;
}

/**
 * The surface a React Aria modal dialog needs, without `useModalOverlay`'s
 * per-element `ariaHideOutside` walk: the page beside the dialog is hidden
 * from assistive technology with one `aria-hidden` per branch as the dialog
 * opens (hide-outside.ts, #552). A non-top-layer portal mounted later is left
 * to its own overlay, and callers still render the underlay (which blocks the
 * pointer) and a FocusScope around the dialog content.
 *
 * Call it before `useRestoreFocus`: the hidden-page cleanup is a passive
 * effect declared here, so it runs before the restore in the same unmount and
 * the opener is focusable again. `hide-outside.test.ts`,
 * `useDialogOverlay.test.tsx`, and `useRestoreFocus.test.tsx` hold the three
 * halves.
 */
export function useDialogOverlay({
  isOpen,
  onClose,
  ref,
  isDismissable = true,
  isKeyboardDismissDisabled = false,
}: DialogOverlayOptions) {
  const { overlayProps, underlayProps } = useOverlay(
    { isOpen, onClose, isDismissable, isKeyboardDismissDisabled },
    ref
  );
  usePreventScroll({ isDisabled: !isOpen });

  useEffect(() => {
    if (!isOpen || !ref.current) return;
    return hideOutsidePortal(ref.current);
  }, [isOpen, ref]);

  return { overlayProps, underlayProps };
}
