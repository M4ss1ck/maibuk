import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { toast, ToastViewport, currentToastMessages } from "@/components/ui/Toast";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

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

  describe("toast.info()", () => {
    it("shows the text alone, with no success or error icon", () => {
      render(<ToastViewport />);

      act(() => {
        toast.info("Start again from Settings", { durationMs: 6000 });
      });

      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("Start again from Settings");
      expect(status.querySelector("svg")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(5999);
      });
      expect(screen.getByText("Start again from Settings")).toBeInTheDocument();
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

  describe("currentToastMessages()", () => {
    it("returns the message of every toast currently in the store", () => {
      act(() => {
        toast.error("x");
      });

      expect(currentToastMessages()).toContain("x");
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

  describe("sticky and actionable toasts", () => {
    function SettingsRoute() {
      const location = useLocation();
      return <p>Settings at {location.hash}</p>;
    }

    it("keeps a durationMs null toast after every timer runs", () => {
      render(<ToastViewport />);

      act(() => {
        toast.info("Pinned", { durationMs: null });
      });
      act(() => {
        vi.runAllTimers();
      });

      expect(screen.getByText("Pinned")).toBeInTheDocument();

      // Sticky toasts survive the outer afterEach's runAllTimers, so close
      // this one to leave the store empty for the next test.
      fireEvent.click(screen.getByRole("button", { name: "common.close" }));
      expect(screen.queryByText("Pinned")).not.toBeInTheDocument();
    });

    it("follows its action on Enter and dismisses the toast", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<p>Library</p>} />
            <Route path="/settings" element={<SettingsRoute />} />
          </Routes>
          <ToastViewport />
        </MemoryRouter>
      );

      act(() => {
        toast.info("Enable the plugin", {
          action: { label: "Open settings", to: "/settings#plugins" },
        });
      });

      await user.tab();
      expect(screen.getByRole("button", { name: "Open settings" })).toHaveFocus();
      await user.keyboard("{Enter}");

      expect(screen.queryByText("Enable the plugin")).not.toBeInTheDocument();
      expect(screen.getByText("Settings at #plugins")).toBeInTheDocument();
    });

    it("closes a sticky toast on Enter in its close button", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      render(<ToastViewport />);

      act(() => {
        toast.error("Could not save", { durationMs: null });
      });

      await user.tab();
      expect(screen.getByRole("button", { name: "common.close" })).toHaveFocus();
      await user.keyboard("{Enter}");

      expect(screen.queryByText("Could not save")).not.toBeInTheDocument();
    });
  });
});
