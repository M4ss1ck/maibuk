import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom has no `inert`, so React Aria would hide outside a Modal with
// aria-hidden and never touch `inert`. Browsers have it, and React Aria sets
// and restores the property there: give jsdom the browser's reflecting
// property before React Aria reads it at import.
vi.hoisted(() => {
  Object.defineProperty(HTMLElement.prototype, "inert", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("inert");
    },
    set(this: HTMLElement, value: boolean) {
      if (value) this.setAttribute("inert", "");
      else this.removeAttribute("inert");
    },
  });
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: "en" } }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const { TutorialBoundary } = await import("@/components/tutorial/TutorialRunner");
const { Modal } = await import("@/components/ui/Modal");
const { useTutorialStore } = await import("@/features/tutorial/store");

function Shell({ offerOpen }: { offerOpen: boolean }) {
  return (
    <>
      <TutorialBoundary>
        <button type="button">App behind the Tutorial</button>
      </TutorialBoundary>
      {/* The shell's live region sits beside the boundary, as in App.tsx:
          React Aria keeps it visible, so it hides the boundary itself. */}
      <div role="status" data-live-announcer="true" />
      <Modal isOpen={offerOpen} onClose={() => {}} title="Take the Tutorial?">
        <button type="button">Start</button>
      </Modal>
    </>
  );
}

const boundary = () => document.querySelector("[data-tutorial-boundary]")!;

afterEach(() => {
  act(() => useTutorialStore.setState({ status: "idle" }));
});

describe("TutorialBoundary", () => {
  it("stays inert through the run when the Tutorial offer closes as it starts", async () => {
    const { rerender } = render(<Shell offerOpen />);
    expect(screen.getByRole("dialog", { name: "Take the Tutorial?" })).toBeInTheDocument();

    act(() => useTutorialStore.setState({ status: "entering" }));
    rerender(<Shell offerOpen={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    // Closing the offer made React Aria restore the boundary to "not inert";
    // the boundary takes it back before the next frame.
    await act(async () => {});
    expect(boundary()).toHaveAttribute("inert");
    act(() => useTutorialStore.setState({ status: "running" }));
    expect(boundary()).toHaveAttribute("inert");
  });

  it("puts inert back if anything else clears it during the run", async () => {
    render(<Shell offerOpen={false} />);
    act(() => useTutorialStore.setState({ status: "running" }));

    boundary().removeAttribute("inert");
    // MutationObserver callbacks run as a microtask.
    await act(async () => {});
    expect(boundary()).toHaveAttribute("inert");
  });

  it("lets the app go once the run ends, and is never inert while idle", () => {
    render(<Shell offerOpen={false} />);
    expect(boundary()).not.toHaveAttribute("inert");

    act(() => useTutorialStore.setState({ status: "running" }));
    expect(boundary()).toHaveAttribute("inert");
    act(() => useTutorialStore.setState({ status: "idle" }));
    expect(boundary()).not.toHaveAttribute("inert");
  });
});
