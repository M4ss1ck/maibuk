import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => `${key}:${options?.name ?? ""}`,
  }),
}));

const settingsState = { hideKeyboardHints: false };
vi.mock("@/features/settings/store", () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

import { PaneFocusFrame } from "@/components/PaneFocusFrame";
import { cyclePanes } from "@/lib/arrow-navigation";

function Fixture() {
  return (
    <>
      <PaneFocusFrame />
      <section data-focus-pane="list" tabIndex={-1} aria-label="Notes list">
        <button type="button">In list</button>
      </section>
      <section data-focus-pane="editor" tabIndex={-1} aria-label="Note editor">
        <button type="button">In editor</button>
      </section>
    </>
  );
}

const pane = (id: string) => document.querySelector<HTMLElement>(`[data-focus-pane="${id}"]`)!;
const button = (name: string) => screen.getByRole("button", { name });

// A keydown first makes React Aria's modality "keyboard", as a real key press would.
function keyboardFocus(el: HTMLElement) {
  fireEvent.keyDown(document.body, { key: "Tab" });
  act(() => el.focus());
}

let animate: ReturnType<typeof vi.fn>;
let reducedMotion = false;
beforeEach(() => {
  settingsState.hideKeyboardHints = false;
  reducedMotion = false;
  animate = vi.fn();
  HTMLElement.prototype.animate = animate as unknown as HTMLElement["animate"];
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes("reduce") && reducedMotion,
  })) as unknown as typeof window.matchMedia;
  // jsdom has no layout; give every Pane a box so the slide has something to measure.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: 100,
    bottom: 100,
    width: 100,
    height: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("PaneFocusFrame", () => {
  it("rings the Pane holding keyboard focus and slides the frame when the keyboard changes Pane", () => {
    render(<Fixture />);
    keyboardFocus(button("In list"));
    expect(pane("list")).toHaveAttribute("data-pane-active");
    expect(animate).not.toHaveBeenCalled();

    keyboardFocus(button("In editor"));
    expect(pane("editor")).toHaveAttribute("data-pane-active");
    expect(pane("list")).not.toHaveAttribute("data-pane-active");
    expect(animate).toHaveBeenCalledTimes(1);
    const [keyframes, options] = animate.mock.calls[0];
    expect(Object.keys(keyframes[0]).sort()).toEqual(["opacity", "transform"]);
    expect(options).toMatchObject({ duration: 180 });
  });

  it("does not ring or slide for pointer input", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.click(button("In list"));
    await user.click(button("In editor"));

    expect(pane("editor")).not.toHaveAttribute("data-pane-active");
    expect(animate).not.toHaveBeenCalled();
  });

  it("hides the ring when the pointer is used after the keyboard", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    keyboardFocus(button("In list"));
    expect(pane("list")).toHaveAttribute("data-pane-active");

    await user.click(button("In list"));
    expect(pane("list")).not.toHaveAttribute("data-pane-active");
  });

  it("skips the slide under reduced motion but still shows the ring", () => {
    reducedMotion = true;
    render(<Fixture />);
    keyboardFocus(button("In list"));
    keyboardFocus(button("In editor"));

    expect(animate).not.toHaveBeenCalled();
    expect(pane("editor")).toHaveAttribute("data-pane-active");
  });

  it("names the Pane briefly after F6", () => {
    vi.useFakeTimers();
    render(<Fixture />);
    fireEvent.keyDown(document.body, { key: "F6" });
    act(() => {
      cyclePanes(true);
    });
    expect(screen.getByTestId("pane-badge")).toHaveTextContent("panes.badge:Notes list");
    expect(screen.getByTestId("pane-badge")).toHaveAttribute("aria-hidden", "true");

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByTestId("pane-badge")).toBeNull();
  });

  it("shows no badge when keyboard hints are hidden", () => {
    settingsState.hideKeyboardHints = true;
    render(<Fixture />);
    act(() => {
      cyclePanes(true);
    });
    expect(screen.queryByTestId("pane-badge")).toBeNull();
  });

  it("shows no badge for an arrow or Tab Pane change, only for F6", () => {
    render(<Fixture />);
    keyboardFocus(button("In list"));
    keyboardFocus(button("In editor"));
    expect(screen.queryByTestId("pane-badge")).toBeNull();
  });
});
