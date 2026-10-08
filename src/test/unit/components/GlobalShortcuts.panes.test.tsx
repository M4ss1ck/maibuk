import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => vi.fn(),
}));

vi.mock("@/lib/platform", () => ({ IS_TAURI: false, IS_DESKTOP: false, isMac: () => false }));

const themeState = { theme: "light", setTheme: vi.fn() };
vi.mock("@/features/theme", () => ({
  useThemeStore: (selector: (state: typeof themeState) => unknown) => selector(themeState),
  getCycledTheme: vi.fn(),
}));

const settingsState = {
  hideKeyboardHints: false,
  setHideKeyboardHints: vi.fn(),
  alwaysOnTop: false,
  setAlwaysOnTop: vi.fn(),
};
vi.mock("@/features/settings/store", () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock("@/features/sync/store", () => ({
  useSyncStore: { getState: () => ({ authStatus: "logged-out", syncStatus: "idle" }) },
}));
vi.mock("@/features/notes", () => ({
  useNoteStore: { getState: () => ({ currentNote: null }) },
}));
vi.mock("@/features/sync/crypto", () => ({ getPassphrase: () => null }));
vi.mock("@/components/ShortcutsHelpDialog", () => ({ ShortcutsHelpDialog: () => null }));

import { GlobalShortcuts } from "@/components/GlobalShortcuts";

function PaneFixture() {
  return (
    <>
      <GlobalShortcuts />
      <button type="button">Outside</button>
      <section data-focus-pane="first" tabIndex={-1} aria-label="First pane">
        <button type="button">Inside first</button>
      </section>
      <section data-focus-pane="second" tabIndex={-1} aria-label="Second pane" />
      <section data-focus-pane="third" tabIndex={-1} aria-label="Third pane" />
    </>
  );
}

function pane(id: string) {
  return document.querySelector<HTMLElement>(`[data-focus-pane="${id}"]`)!;
}

describe("GlobalShortcuts pane cycling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enters, advances in DOM order, and wraps with F6", async () => {
    const user = userEvent.setup();
    render(<PaneFixture />);
    const outside = document.querySelector("button")!;
    outside.focus();

    // A Pane with a control lands on it; an empty Pane takes focus itself.
    await user.keyboard("{F6}");
    expect(screen.getByRole("button", { name: "Inside first" })).toHaveFocus();
    await user.keyboard("{F6}");
    expect(pane("second")).toHaveFocus();
    await user.keyboard("{F6}");
    expect(pane("third")).toHaveFocus();
    await user.keyboard("{F6}");
    expect(screen.getByRole("button", { name: "Inside first" })).toHaveFocus();
  });

  it("cycles in reverse and wraps with Shift+F6", async () => {
    const user = userEvent.setup();
    render(<PaneFixture />);
    pane("first").focus();

    await user.keyboard("{Shift>}{F6}{/Shift}");
    expect(pane("third")).toHaveFocus();
    await user.keyboard("{Shift>}{F6}{/Shift}");
    expect(pane("second")).toHaveFocus();
  });

  it("advances from focus inside a pane rather than treating it as outside", async () => {
    const user = userEvent.setup();
    render(<PaneFixture />);
    document.querySelector<HTMLButtonElement>("[data-focus-pane=first] button")!.focus();

    await user.keyboard("{F6}");
    expect(pane("second")).toHaveFocus();
  });

  it("skips hidden, inert, aria-hidden, and closed panes", async () => {
    const user = userEvent.setup();
    render(
      <>
        <GlobalShortcuts />
        <section data-focus-pane="first" tabIndex={-1} />
        <section data-focus-pane="hidden" tabIndex={-1} hidden />
        <div inert>
          <section data-focus-pane="inert" tabIndex={-1} />
        </div>
        <div aria-hidden="true">
          <section data-focus-pane="aria-hidden" tabIndex={-1} />
        </div>
        <div data-closed="">
          <section data-focus-pane="closed" tabIndex={-1} />
        </div>
        <section data-focus-pane="display-none" tabIndex={-1} style={{ display: "none" }} />
        <section data-focus-pane="last" tabIndex={-1} />
      </>
    );
    pane("first").focus();

    await user.keyboard("{F6}");
    expect(pane("last")).toHaveFocus();
  });

  describe("nested panes (the Book Editor's chapter wrapper holds the Chapter list)", () => {
    function NestedFixture() {
      return (
        <>
          <GlobalShortcuts />
          <div data-focus-pane="wrapper" tabIndex={-1}>
            <aside data-focus-pane="inner" tabIndex={-1} aria-label="Chapter list">
              <button type="button">Row</button>
            </aside>
          </div>
          <main data-focus-pane="editor" tabIndex={-1} aria-label="Editor" />
        </>
      );
    }

    it("stops on the inner, named pane and never on the wrapper", async () => {
      const user = userEvent.setup();
      render(<NestedFixture />);
      pane("editor").focus();

      await user.keyboard("{F6}");
      expect(screen.getByRole("button", { name: "Row" })).toHaveFocus();
      await user.keyboard("{F6}");
      expect(pane("editor")).toHaveFocus();
      await user.keyboard("{F6}");
      expect(screen.getByRole("button", { name: "Row" })).toHaveFocus();
    });

    it("moves on from focus inside the inner pane instead of staying there", async () => {
      const user = userEvent.setup();
      render(<NestedFixture />);
      screen.getByRole("button", { name: "Row" }).focus();

      await user.keyboard("{F6}");
      expect(pane("editor")).toHaveFocus();
      await user.keyboard("{Shift>}{F6}{/Shift}");
      expect(screen.getByRole("button", { name: "Row" })).toHaveFocus();
    });

    it("treats focus on the wrapper as being in its inner pane", async () => {
      const user = userEvent.setup();
      render(<NestedFixture />);
      pane("wrapper").focus();

      await user.keyboard("{F6}");
      expect(pane("editor")).toHaveFocus();
    });
  });

  describe("a pane inside another that keeps its own stop (the Footnotes after the text)", () => {
    function TextFixture() {
      return (
        <>
          <GlobalShortcuts />
          <aside data-focus-pane="chapters" tabIndex={-1} aria-label="Chapters" />
          <main data-focus-pane="editor" tabIndex={-1} aria-label="Editor">
            <div contentEditable data-testid="text" />
            <section
              data-focus-pane="footnotes"
              data-focus-pane-nested=""
              tabIndex={-1}
              aria-label="Footnotes"
            >
              <button type="button">Entry</button>
            </section>
          </main>
        </>
      );
    }

    it("stops on the outer pane and then on the nested one, in DOM order", async () => {
      const user = userEvent.setup();
      render(<TextFixture />);
      pane("chapters").focus();

      // The editor lands in its text, never on the Footnotes control inside it.
      await user.keyboard("{F6}");
      expect(screen.getByTestId("text")).toHaveFocus();
      await user.keyboard("{F6}");
      expect(screen.getByRole("button", { name: "Entry" })).toHaveFocus();
      await user.keyboard("{F6}");
      expect(pane("chapters")).toHaveFocus();
    });

    it("moves from the text to the nested pane, and back out of it", async () => {
      const user = userEvent.setup();
      render(<TextFixture />);
      screen.getByTestId("text").focus();

      await user.keyboard("{F6}");
      expect(screen.getByRole("button", { name: "Entry" })).toHaveFocus();
      await user.keyboard("{F6}");
      expect(pane("chapters")).toHaveFocus();
      await user.keyboard("{Shift>}{F6}{/Shift}");
      expect(screen.getByRole("button", { name: "Entry" })).toHaveFocus();
      // The editor remembers its text, not the Footnotes control used since.
      await user.keyboard("{Shift>}{F6}{/Shift}");
      expect(screen.getByTestId("text")).toHaveFocus();
    });
  });

  describe("landing (ADR 0025 rule 8)", () => {
    function LandingFixture({ withLast = true }: { withLast?: boolean }) {
      return (
        <>
          <GlobalShortcuts />
          <section data-focus-pane="list" tabIndex={-1} aria-label="List">
            <input aria-label="Search" />
            <button type="button">Sort</button>
            <button type="button" data-focus-pane-entry="">
              Entry
            </button>
            {withLast && <button type="button">Last used</button>}
          </section>
          <section data-focus-pane="editor" tabIndex={-1} aria-label="Editor">
            <input aria-label="Title" />
          </section>
        </>
      );
    }

    it("lands on the Pane's declared entry before its first control", async () => {
      const user = userEvent.setup();
      render(<LandingFixture />);
      pane("editor").focus();

      await user.keyboard("{F6}");
      expect(screen.getByRole("button", { name: "Entry" })).toHaveFocus();
    });

    it("returns to the control last used in the Pane", async () => {
      const user = userEvent.setup();
      render(<LandingFixture />);
      screen.getByRole("button", { name: "Last used" }).focus();

      await user.keyboard("{F6}");
      expect(screen.getByRole("textbox", { name: "Title" })).toHaveFocus();
      await user.keyboard("{Shift>}{F6}{/Shift}");
      expect(screen.getByRole("button", { name: "Last used" })).toHaveFocus();
    });

    it("falls back to the entry when the remembered control is gone", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<LandingFixture />);
      screen.getByRole("button", { name: "Last used" }).focus();
      await user.keyboard("{F6}");
      rerender(<LandingFixture withLast={false} />);

      await user.keyboard("{Shift>}{F6}{/Shift}");
      expect(screen.getByRole("button", { name: "Entry" })).toHaveFocus();
    });

    it("skips text entry for the first control, and takes it when it is all there is", async () => {
      const user = userEvent.setup();
      render(
        <>
          <GlobalShortcuts />
          <section data-focus-pane="bar" tabIndex={-1} aria-label="Bar">
            <input aria-label="Name" />
            <button type="button">Action</button>
          </section>
          <section data-focus-pane="editor" tabIndex={-1} aria-label="Editor">
            <input aria-label="Title" />
          </section>
        </>
      );
      pane("editor").focus();

      await user.keyboard("{F6}");
      expect(screen.getByRole("button", { name: "Action" })).toHaveFocus();
      await user.keyboard("{F6}");
      expect(screen.getByRole("textbox", { name: "Title" })).toHaveFocus();
    });
  });

  it("works while a contenteditable typing target has focus", async () => {
    const user = userEvent.setup();
    render(
      <>
        <GlobalShortcuts />
        <div contentEditable data-testid="editor" />
        <section data-focus-pane="first" tabIndex={-1} />
      </>
    );
    const editor = document.querySelector<HTMLElement>("[contenteditable]")!;
    editor.focus();

    await user.keyboard("{F6}");
    expect(pane("first")).toHaveFocus();
  });
});
