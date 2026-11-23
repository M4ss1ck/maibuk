import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";
import { CheckIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/Button";

const DEFAULT_DURATION_MS = 2000;
const MAX_TOASTS = 3;

/** `info` is text only: a hint, not the outcome of an action. */
type ToastVariant = "success" | "error" | "info";

type ToastAction = {
  label: string;
  to: string;
};

type Toast = {
  id: string;
  message: string;
  variant: ToastVariant;
  /** `null` keeps the toast until its close button removes it. */
  durationMs: number | null;
  action?: ToastAction;
};

type ToastInput = {
  message: string;
  variant?: ToastVariant;
  /** `null` keeps the toast until closed. Omitted, it dismisses after the default. */
  durationMs?: number | null;
  action?: ToastAction;
};

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Toast) => void;
  removeToast: (id: string) => void;
}

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (toast) =>
    set((state) => {
      const next = [...state.toasts, toast];
      if (next.length > MAX_TOASTS) {
        next.splice(0, next.length - MAX_TOASTS);
      }
      return { toasts: next };
    }),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),
}));

function createToastId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isFocusModeActive(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(".focus-mode") !== null;
}

type InternalToastInput = ToastInput & { bypassFocusMode?: boolean };

function showToast(input: InternalToastInput): void {
  if (!input.bypassFocusMode && isFocusModeActive()) return;
  const id = createToastId();
  const durationMs = input.durationMs === undefined ? DEFAULT_DURATION_MS : input.durationMs;
  const toast: Toast = {
    id,
    message: input.message,
    variant: input.variant ?? "success",
    durationMs,
    action: input.action,
  };

  useToastStore.getState().addToast(toast);

  if (durationMs === null) return;
  setTimeout(() => {
    useToastStore.getState().removeToast(id);
  }, durationMs);
}

export const toast = {
  success: (message: string, options: Omit<ToastInput, "message" | "variant"> = {}) =>
    showToast({ message, variant: "success", ...options }),
  error: (message: string, options: Omit<InternalToastInput, "message" | "variant"> = {}) =>
    showToast({ message, variant: "error", ...options }),
  info: (message: string, options: Omit<ToastInput, "message" | "variant"> = {}) =>
    showToast({ message, variant: "info", ...options }),
};

export function forceToastError(message: string): void {
  showToast({ message, variant: "error", bypassFocusMode: true });
}

/**
 * The messages of the toasts currently showing. The conformance launch report
 * records them (#922); the store itself stays private.
 */
export function currentToastMessages(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

/** Mounted only by a toast with an action, so the viewport needs no Router. */
function ToastActionButton({ id, action }: { id: string; action: ToastAction }) {
  const navigate = useNavigate();
  const removeToast = useToastStore((state) => state.removeToast);

  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        removeToast(id);
        navigate(action.to);
      }}
    >
      {action.label}
    </Button>
  );
}

/** Mounted only by a sticky toast, so the viewport needs no i18n provider. */
function ToastCloseButton({ id }: { id: string }) {
  const { t } = useTranslation();
  const removeToast = useToastStore((state) => state.removeToast);

  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={t("common.close")}
      onClick={() => removeToast(id)}
    >
      <XIcon className="h-4 w-4" />
    </Button>
  );
}

export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);

  // Toasts paint above an open Modal: z-60 clears the Modal's z-50 backdrop,
  // which is portaled after this viewport and would otherwise cover it. They
  // also join React Aria's top layer, so the Modal leaves them visible to
  // assistive technology, as React Aria's own toast region does. The region
  // stays pointer-events-none; only a toast with an action or a close button
  // catches a click or tap, so the rest pass through to what lies beneath.
  return (
    <div
      data-react-aria-top-layer
      className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-[calc(1.5rem+env(safe-area-inset-right))] z-60 flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const sticky = toast.durationMs === null;
        const interactive = sticky || toast.action !== undefined;
        return (
          <div
            key={toast.id}
            className={`flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-sm text-foreground toast-enter${interactive ? " pointer-events-auto" : ""}`}
            role="status"
          >
            {toast.variant === "success" && <CheckIcon className="h-4 w-4 text-success" />}
            {toast.variant === "error" && <XIcon className="h-4 w-4 text-destructive" />}
            <span>{toast.message}</span>
            {toast.action && <ToastActionButton id={toast.id} action={toast.action} />}
            {sticky && <ToastCloseButton id={toast.id} />}
          </div>
        );
      })}
    </div>
  );
}
