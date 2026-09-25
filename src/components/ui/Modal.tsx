import { type CSSProperties, type ReactNode, type RefObject, useEffect, useMemo, useRef } from "react";
import { FocusScope, Overlay, useFocusManager, useModalOverlay } from "react-aria";
import { Dialog, Heading } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "@/components/icons";
import { useModalStore } from "@/components/ui/modal-store";
import { useModalScope, useRestoreFocus } from "@/hooks";
import { registerBackDismiss } from "@/lib/platform/backDismiss";

/**
 * Enter on a native <button> fires a click React Aria reads as virtual (a
 * screen reader's); for those it defers the dialog's autofocus until running
 * CSS transitions end, and drops it once the inert page has blurred the
 * trigger, stranding focus on <body>. Rendered after the dialog content, so a
 * control the content focused itself wins; otherwise the first tabbable one.
 */
function FocusFirstIfOutside({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const focusManager = useFocusManager();
  useEffect(() => {
    const container = containerRef.current;
    if (container && !container.contains(document.activeElement)) {
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
  size?: "md" | "wide";
  contentClassName?: string;
  panelClassName?: string;
  panelStyle?: CSSProperties;
  titleClassName?: string;
  unstyled?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "md",
  contentClassName = "overflow-auto",
  panelClassName,
  panelStyle,
  titleClassName,
  unstyled = false,
}: ModalProps) {
  const { t } = useTranslation();
  const sizeClass = size === "wide" ? "sm:max-w-5xl" : "sm:max-w-md";

  const modalId = useModalScope(isOpen);
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
  const { modalProps, underlayProps } = useModalOverlay(
    { isDismissable: true, isKeyboardDismissDisabled: true },
    state,
    modalRef
  );

  // After useModalOverlay: its inert cleanup must run before the restore.
  useRestoreFocus(isOpen);

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
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 modal-backdrop-enter"
        >
          <div
            {...modalProps}
            ref={modalRef}
            style={panelClassName ? panelStyle : { maxHeight: "90dvh", ...panelStyle }}
            className={
              panelClassName ??
              `relative bg-background rounded-t-xl sm:rounded-xl shadow-xl w-full ${sizeClass} sm:mx-4 max-h-[90vh] overflow-hidden flex flex-col modal-panel-enter`
            }
          >
            <Dialog
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
                    <Heading slot="title" level={2} className="text-base sm:text-lg font-semibold">
                      {title}
                    </Heading>
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
