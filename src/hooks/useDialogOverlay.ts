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
 * from assistive technology with one `aria-hidden` per branch (hide-outside.ts,
 * #552), while the underlay blocks the pointer and FocusScope keeps Tab inside.
 *
 * Call it before `useRestoreFocus`: the hidden-page cleanup is a passive
 * effect declared here, so it runs before the restore in the same unmount and
 * the opener is focusable again. `hide-outside.test.ts` and
 * `useRestoreFocus.test.tsx` hold both halves.
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
