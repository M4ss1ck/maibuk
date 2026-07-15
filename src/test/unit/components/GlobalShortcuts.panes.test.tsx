import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => vi.fn(),
}));

vi.mock("@/lib/platform", () => ({ IS_TAURI: false, isMac: () => false }));

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
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) =>
    selector(settingsState),
}));

vi.mock("@/features/sync/store", () => ({
  useSyncStore: { getState: () => ({ authStatus: "logged-out", syncStatus: "idle" }) },
}));
vi.mock("@/features/notes", () => ({
  useNoteStore: { getState: () => ({ currentNote: null }) },
}));
vi.mock("@/features/sync/crypto", () => ({ getPassphrase: () => null }));
vi.mock("@/hooks", () => ({ useActiveShortcuts: () => [] }));
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

    await user.keyboard("{F6}");
    expect(pane("first")).toHaveFocus();
    await user.keyboard("{F6}");
    expect(pane("second")).toHaveFocus();
    await user.keyboard("{F6}");
    expect(pane("third")).toHaveFocus();
    await user.keyboard("{F6}");
    expect(pane("first")).toHaveFocus();
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
