import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { toast, ToastViewport } from "@/components/ui/Toast";

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Flush all pending auto-dismiss setTimeout callbacks so the
    // internal Zustand store is empty before the next test.
    act(() => {
      vi.runAllTimers();
    });
    vi.useRealTimers();
  });

  describe("toast.success()", () => {
    it("displays a success toast message", () => {
      render(<ToastViewport />);

      act(() => {
        toast.success("Saved!");
      });

      expect(screen.getByText("Saved!")).toBeInTheDocument();
    });

    it("renders toast with status role", () => {
      render(<ToastViewport />);

      act(() => {
        toast.success("Done");
      });

      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("auto-dismisses after default duration", () => {
      render(<ToastViewport />);

      act(() => {
        toast.success("Temporary");
      });

      expect(screen.getByText("Temporary")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(screen.queryByText("Temporary")).not.toBeInTheDocument();
    });

    it("supports custom duration", () => {
      render(<ToastViewport />);

      act(() => {
        toast.success("Quick", { durationMs: 500 });
      });

      expect(screen.getByText("Quick")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(screen.queryByText("Quick")).not.toBeInTheDocument();
    });
  });

  describe("multiple toasts", () => {
    it("shows multiple toasts simultaneously", () => {
      render(<ToastViewport />);

      act(() => {
        toast.success("First");
        toast.success("Second");
      });

      expect(screen.getByText("First")).toBeInTheDocument();
      expect(screen.getByText("Second")).toBeInTheDocument();
    });

    it("limits to MAX_TOASTS (3)", () => {
      render(<ToastViewport />);

      act(() => {
        toast.success("One");
        toast.success("Two");
        toast.success("Three");
        toast.success("Four");
      });

      // First toast should have been dropped
      expect(screen.queryByText("One")).not.toBeInTheDocument();
      expect(screen.getByText("Two")).toBeInTheDocument();
      expect(screen.getByText("Three")).toBeInTheDocument();
      expect(screen.getByText("Four")).toBeInTheDocument();
    });
  });

  describe("focus mode suppression", () => {
    it("does not show toast when focus mode is active", () => {
      // Add focus-mode element to DOM
      const focusEl = document.createElement("div");
      focusEl.className = "focus-mode";
      document.body.appendChild(focusEl);

      render(<ToastViewport />);

      act(() => {
        toast.success("Suppressed");
      });

      expect(screen.queryByText("Suppressed")).not.toBeInTheDocument();

      // Cleanup
      document.body.removeChild(focusEl);
    });
  });

  describe("ToastViewport", () => {
    it("renders with aria-live polite for accessibility", () => {
      const { container } = render(<ToastViewport />);
      const viewport = container.firstElementChild;
      expect(viewport).toHaveAttribute("aria-live", "polite");
    });

    it("renders empty when no toasts", () => {
      render(<ToastViewport />);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });
});
