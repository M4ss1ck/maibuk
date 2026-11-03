import { useEffect, useMemo, type RefObject } from "react";
import { useOverlay, usePreventScroll } from "react-aria";
import { hideOutsidePortal } from "@/lib/hide-outside";
import { isIOS } from "@/lib/platform/detect";

interface DialogOverlayOptions {
  isOpen: boolean;
  onClose: () => void;
  /** The dialog's panel, the element the overlay portal contains. */
  ref: RefObject<HTMLElement | null>;
  isDismissable?: boolean;
  isKeyboardDismissDisabled?: boolean;
}

// iOS Safari moves a page that does not overflow, and React Aria's branch for it
// handles touch as well as the style write.
function pageCanMove() {
  const { scrollHeight, clientHeight, scrollWidth, clientWidth } = document.documentElement;
  return isIOS() || scrollHeight > clientHeight || scrollWidth > clientWidth;
}

/**
 * The surface a React Aria modal dialog needs, without `useModalOverlay`'s
 * per-element `ariaHideOutside` walk: the page beside the dialog is hidden
 * from assistive technology with one `aria-hidden` per branch as the dialog
 * opens (hide-outside.ts, #552). A non-top-layer portal mounted later is left
 * to its own overlay, and callers still render the underlay (which blocks the
 * pointer) and a FocusScope around the dialog content.
 *
 * The scroll lock runs only when the page can move, decided once per open: it
 * writes an inline style on `<html>`, which WebKit pays for with a restyle of the
 * whole document (CODING_STANDARDS.md, "Scroll lock").
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
  const locksScroll = useMemo(() => isOpen && pageCanMove(), [isOpen]);
  usePreventScroll({ isDisabled: !locksScroll });

  useEffect(() => {
    if (!isOpen || !ref.current) return;
    return hideOutsidePortal(ref.current);
  }, [isOpen, ref]);

  return { overlayProps, underlayProps };
}
