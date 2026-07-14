import { type ReactNode } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "@/components/icons";
import { useModalScope } from "@/hooks";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "wide";
  contentClassName?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "md",
  contentClassName = "overflow-auto",
}: ModalProps) {
  const { t } = useTranslation();
  const sizeClass = size === "wide" ? "sm:max-w-5xl" : "sm:max-w-md";

  useModalScope(isOpen);

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/50 modal-backdrop-enter" />

      <div className="fixed inset-0 flex items-end sm:items-center justify-center">
        <DialogPanel
          className={`relative bg-background rounded-t-xl sm:rounded-xl shadow-xl w-full ${sizeClass} sm:mx-4 max-h-[90vh] overflow-hidden flex flex-col modal-panel-enter`}
        >
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-border shrink-0">
            <DialogTitle as="h2" className="text-base sm:text-lg font-semibold">
              {title}
            </DialogTitle>
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
            <div className="flex items-center justify-end gap-3 px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-muted/30 shrink-0">
              {footer}
            </div>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
