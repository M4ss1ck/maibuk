import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { FocusScope, Overlay, useFocusManager } from "react-aria";
import { Dialog, Heading } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "@/components/icons";
import { useModalStore } from "@/components/ui/modal-store";
import { useDialogOverlay, useModalScope, useRestoreFocus } from "@/hooks";
import { registerBackDismiss } from "@/lib/platform/backDismiss";

/**
 * Enter on a native <button> fires a click React Aria reads as virtual (a
 * screen reader's); for those it defers the dialog's autofocus until running
 * CSS transitions end, and drops it once the hidden page has blurred the
 * trigger, stranding focus on <body>. Rendered after the dialog content, so a
 * control the content focused itself wins; otherwise the first tabbable one.
 *
 * A field that asked for autofocus always wins: a dialog opened from a closing
 * React Aria overlay (a menu) loses that focus to the overlay's restoration and
 * to the dialog's own container focus, so the field is re-focused here.
 */
function FocusFirstIfOutside({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const focusManager = useFocusManager();
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const preferred = container.querySelector<HTMLElement>("[data-autofocus]");
    if (preferred) {
      preferred.focus();
      return;
    }
    if (!container.contains(document.activeElement)) {
      focusManager?.focusFirst({ tabbable: true });
    }
  }, [containerRef, focusManager]);
  return null;
}

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Controls beside the close button in the header. */
  headerActions?: ReactNode;
  /** "xl" is the editing-surface width (about 960px), for a dialog that previews the app. */
  size?: "md" | "lg" | "xl" | "wide";
  /** Fills the screen on a phone, with the content scrolling between header and footer. */
  fullScreenOnPhone?: boolean;
  contentClassName?: string;
  panelClassName?: string;
  panelStyle?: CSSProperties;
  titleClassName?: string;
  unstyled?: boolean;
  /**
   * Where focus returns when the Modal closes, when that is not the opener
   * (e.g. a dialog opened from another dialog). Returning null falls back to
   * the element focused when the Modal opened.
   */
  restoreFocusTarget?: () => HTMLElement | null;
  /** "top" pins the panel to the top edge on every screen size, like a command bar. */
  placement?: "center" | "top";
  /** "alertdialog" announces the dialog's urgency; a confirmation dialog uses it. */
  role?: "dialog" | "alertdialog";
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  headerActions,
  size = "md",
  fullScreenOnPhone = false,
  contentClassName = "overflow-auto",
  panelClassName,
  panelStyle,
  titleClassName,
  unstyled = false,
  restoreFocusTarget,
  placement = "center",
  role = "dialog",
}: ModalProps) {
  const { t } = useTranslation();
  const sizeClass = {
    md: "sm:max-w-md",
    lg: "sm:max-w-2xl",
    xl: "sm:max-w-[60rem]",
    wide: "sm:max-w-5xl",
  }[size];
  const phoneClass = fullScreenOnPhone
    ? "max-sm:h-dvh max-sm:max-h-none max-sm:rounded-none max-sm:pt-[env(safe-area-inset-top)]"
    : "";

  const modalId = useModalScope(isOpen, () => onCloseRef.current());
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const state = useMemo(
    () => ({
      isOpen,
      open: () => undefined,
      close: onClose,
      toggle: () => {
        if (isOpen) onClose();
      },
      setOpen: (open: boolean) => {
        if (!open) onClose();
      },
    }),
    [isOpen, onClose]
  );
  const { overlayProps, underlayProps } = useDialogOverlay({
    isOpen: state.isOpen,
    onClose: state.close,
    ref: modalRef,
    isKeyboardDismissDisabled: true,
  });

  // After useDialogOverlay: its hidden-page cleanup must run before the restore.
  useRestoreFocus(isOpen, { getTarget: restoreFocusTarget });

  useEffect(() => {
    if (!isOpen) return;
    return registerBackDismiss(() => {
      onCloseRef.current();
      return true;
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      const modalIds = useModalStore.getState().modalIds;
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        modalIds[modalIds.length - 1] === modalId
      ) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, modalId, onClose]);

  if (!isOpen) return null;

  return (
    <Overlay disableFocusManagement>
      <FocusScope contain autoFocus>
        <div
          {...underlayProps}
          className={
            placement === "top"
              ? "fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[env(safe-area-inset-top)] modal-backdrop-enter"
              : "fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 modal-backdrop-enter"
          }
        >
          <div
            {...overlayProps}
            ref={modalRef}
            style={
              panelClassName || fullScreenOnPhone
                ? panelStyle
                : { maxHeight: "90dvh", ...panelStyle }
            }
            className={
              panelClassName ??
              `relative bg-background rounded-t-xl sm:rounded-xl shadow-xl w-full ${sizeClass} sm:mx-4 max-h-[90vh] ${fullScreenOnPhone ? "sm:max-h-[90dvh]" : ""} ${phoneClass} overflow-hidden flex flex-col modal-panel-enter`
            }
          >
            <Dialog
              role={role}
              className={
                unstyled ? "contents outline-none" : "flex min-h-0 flex-1 flex-col outline-none"
              }
            >
              {unstyled ? (
                <>
                  <Heading slot="title" level={2} className={titleClassName ?? "sr-only"}>
                    {title}
                  </Heading>
                  {children}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-border shrink-0">
                    <Heading
                      slot="title"
                      level={2}
                      className="min-w-0 flex-1 text-base sm:text-lg font-semibold"
                    >
                      {title}
                    </Heading>
                    {headerActions && (
                      <div className="flex shrink-0 items-center gap-2 mr-2">{headerActions}</div>
                    )}
                    <button
                      type="button"
                      onClick={onClose}
                      className="p-1 hover:bg-muted rounded-lg transition-colors"
                      aria-label={t("common.close")}
                    >
                      <CloseIcon className="w-5 h-5" />
                    </button>
                  </div>

                  <div className={`px-4 sm:px-6 py-4 flex-1 min-h-0 ${contentClassName}`}>
                    {children}
                  </div>

                  {footer && (
                    <div className="flex flex-wrap items-center justify-end gap-3 px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/30 shrink-0">
                      {footer}
                    </div>
                  )}
                </>
              )}
            </Dialog>
            <div className="h-[env(safe-area-inset-bottom)] shrink-0" aria-hidden="true" />
          </div>
        </div>
        <FocusFirstIfOutside containerRef={modalRef} />
      </FocusScope>
    </Overlay>
  );
}
