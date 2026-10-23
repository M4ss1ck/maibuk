import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "react-aria-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/features/settings/store", () => ({
  useSettingsStore: (selector: (state: { hideKeyboardHints: boolean }) => unknown) =>
    selector({ hideKeyboardHints: false }),
}));

// The private path focusReturn imports: this fails first if React Aria moves it.
import { getInteractionModality } from "react-aria/private/interactions/useFocusVisible";
import { PaneFocusFrame } from "@/components/PaneFocusFrame";
import { installFocusReturn } from "@/lib/window/focusReturn";

function Fixture() {
  return (
    <>
      <PaneFocusFrame />
      <section data-focus-pane="editor" tabIndex={-1} aria-label="Note editor">
        <Button>Bold</Button>
        {/* biome-ignore lint/a11y/useSemanticElements: a contenteditable textbox, as the TipTap editor renders it. */}
        <div role="textbox" aria-label="Text" aria-multiline="true" contentEditable tabIndex={0} />
        <iframe title="Plugin" />
      </section>
    </>
  );
}

const pane = () => document.querySelector<HTMLElement>('[data-focus-pane="editor"]')!;
const frame = () => screen.getByTestId("pane-frame");

// What the browser does when another app takes the window (Alt+Tab, a taskbar
// click): the focused control blurs and the document loses focus.
function leaveWindow(el: HTMLElement) {
  act(() => {
    el.blur();
    fireEvent.blur(window);
  });
}

// Coming back, the browser restores focus to that same control, with no key
// or pointer event in the page first.
function returnToWindow(el: HTMLElement) {
  act(() => {
    fireEvent.focus(window);
    el.focus();
  });
}

let uninstall: () => void;
beforeEach(() => {
  uninstall = installFocusReturn();
  HTMLElement.prototype.animate = vi.fn() as unknown as HTMLElement["animate"];
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
  uninstall();
  vi.restoreAllMocks();
});

describe("installFocusReturn", () => {
  it("keeps the Pane ring hidden when the author typed, left the window, and came back", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const text = screen.getByRole("textbox", { name: "Text" });
    await user.click(text);
    await user.keyboard("a");
    expect(frame().style.opacity).toBe("0");

    leaveWindow(text);
    returnToWindow(text);

    expect(text).toHaveFocus();
    expect(pane()).not.toHaveAttribute("data-pane-active");
    expect(frame().style.opacity).toBe("0");
  });

  it("hides a control's own focus ring after a return, and Tab brings rings back", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const bold = screen.getByRole("button", { name: "Bold" });
    await user.tab();
    expect(bold).toHaveFocus();
    expect(bold).toHaveAttribute("data-focus-visible");
    expect(pane()).toHaveAttribute("data-pane-active");

    leaveWindow(bold);
    returnToWindow(bold);

    expect(bold).toHaveFocus();
    expect(bold).not.toHaveAttribute("data-focus-visible");
    expect(pane()).not.toHaveAttribute("data-pane-active");

    await user.tab();
    expect(screen.getByRole("textbox", { name: "Text" })).toHaveFocus();
    expect(pane()).toHaveAttribute("data-pane-active");
    expect(frame().style.opacity).toBe("1");
  });

  it("keeps the keyboard modality when a key moved focus after the window came back", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const bold = screen.getByRole("button", { name: "Bold" });
    await user.tab();
    leaveWindow(bold);
    // A key in the page first means the author, not the browser, moved focus.
    fireEvent.keyDown(document.body, { key: "Tab" });
    returnToWindow(bold);

    expect(getInteractionModality()).toBe("keyboard");
    expect(bold).toHaveAttribute("data-focus-visible");
  });

  it("does not treat focus moving into a Plugin's iframe and back as leaving the app", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const bold = screen.getByRole("button", { name: "Bold" });
    await user.tab();
    // The iframe element takes focus in this document, then the window blurs.
    act(() => {
      screen.getByTitle("Plugin").focus();
      fireEvent.blur(window);
    });
    returnToWindow(bold);

    expect(getInteractionModality()).toBe("keyboard");
    expect(bold).toHaveAttribute("data-focus-visible");
  });

  it("leaves the modality alone when focus lands somewhere other than where it left", async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const bold = screen.getByRole("button", { name: "Bold" });
    await user.tab();
    leaveWindow(bold);
    returnToWindow(screen.getByRole("textbox", { name: "Text" }));

    expect(getInteractionModality()).toBe("keyboard");
  });

  it("stops acting once uninstalled", async () => {
    const user = userEvent.setup();
    uninstall();
    render(<Fixture />);
    const bold = screen.getByRole("button", { name: "Bold" });
    await user.tab();
    leaveWindow(bold);
    returnToWindow(bold);

    expect(bold).toHaveAttribute("data-focus-visible");
  });
});
