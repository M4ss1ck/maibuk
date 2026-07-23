import { create } from "zustand";
import { CheckIcon, XIcon } from "@/components/icons";

const DEFAULT_DURATION_MS = 2000;
const MAX_TOASTS = 3;

type ToastVariant = "success" | "error";

type Toast = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type ToastInput = {
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
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

function showToast(input: ToastInput): void {
  if (isFocusModeActive()) return;
  const id = createToastId();
  const toast: Toast = {
    id,
    message: input.message,
    variant: input.variant ?? "success",
  };

  useToastStore.getState().addToast(toast);

  const duration = input.durationMs ?? DEFAULT_DURATION_MS;
  setTimeout(() => {
    useToastStore.getState().removeToast(id);
  }, duration);
}

export const toast = {
  success: (message: string, options: Omit<ToastInput, "message" | "variant"> = {}) =>
    showToast({ message, variant: "success", ...options }),
  error: (message: string, options: Omit<ToastInput, "message" | "variant"> = {}) =>
    showToast({ message, variant: "error", ...options }),
};

export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);

  return (
    <div
      className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-[calc(1.5rem+env(safe-area-inset-right))] z-50 flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-sm text-foreground toast-enter"
          role="status"
        >
          {toast.variant === "success" && <CheckIcon className="h-4 w-4 text-success" />}
          {toast.variant === "error" && <XIcon className="h-4 w-4 text-destructive" />}
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
