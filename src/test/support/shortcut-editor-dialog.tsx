// Shared setup and keyboard helpers for the Shortcut Editor tests (#851).
import { useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, expect, vi } from "vitest";
import { mockVirtualizerLayout } from "@/test/support/virtualizer-layout";
import { ShortcutEditorDialog } from "@/components/shortcuts/ShortcutEditorDialog";
import { useModalStore } from "@/components/ui/modal-store";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { DEFAULT_SHORTCUT_SETTINGS } from "@/lib/shortcut-resolve";

// A hoisted binding cannot carry `export` itself, so each one is exported by alias.
const hoistedTranslate = vi.hoisted(() =>
  vi.fn((key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key
  )
);
export const translate = hoistedTranslate;

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: translate,
    i18n: { language: "en" },
  }),
}));

vi.mock("@/lib/platform/detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform/detect")>()),
  isMac: () => false,
}));

const hoistedFile = vi.hoisted(() => ({
  save: vi.fn(async () => true),
  pick: vi.fn(async (): Promise<string | null> => null),
}));
export const file = hoistedFile;
vi.mock("@/features/settings/shortcut-file", () => ({
  saveShortcutFile: hoistedFile.save,
  pickShortcutFileText: hoistedFile.pick,
}));

let restoreLayout: () => void;
beforeAll(() => {
  restoreLayout = mockVirtualizerLayout({ width: 900, height: 4000 });
});
afterAll(() => {
  restoreLayout();
});

export function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open editor
      </button>
      <ShortcutEditorDialog isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}

export const custom = () => useShortcutSettingsStore.getState().shortcuts.custom;

export const voice = () => useShortcutSettingsStore.getState().shortcuts.voice;

export async function openEditor() {
  const user = userEvent.setup();
  render(<Harness />);
  await user.tab();
  await user.keyboard("{Enter}");
  const dialog = await screen.findByRole("dialog");
  return { user, dialog };
}

/** Filters to one Command and moves focus into its row. */
export async function focusRow(user: ReturnType<typeof userEvent.setup>, query: string) {
  const search = screen.getByRole("searchbox");
  await act(async () => {
    search.focus();
  });
  await user.clear(search);
  await user.paste(query);
  const grid = screen.getByRole("grid");
  // Tab leaves the search field for the filter group, then the grid.
  while (!grid.contains(document.activeElement)) await user.tab();
  return grid;
}

/**
 * A nested dialog by its title. Role queries compute every accessible name in the
 * rendered Command list, which alone takes seconds per retry under coverage.
 */
export async function findDialogTitled(title: string) {
  const heading = await screen.findByText(title, { selector: "h1, h2, h3" });
  const dialog = heading.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  expect(dialog).not.toBeNull();
  return dialog as HTMLElement;
}

/**
 * Narrows the list before a nested dialog: user-event's Tab checks every
 * focusable control in the document, and the full Command list makes each
 * press cost seconds under coverage.
 */
export async function narrowList(user: ReturnType<typeof userEvent.setup>, query: string) {
  const search = screen.getByRole("searchbox");
  await act(async () => search.focus());
  await user.paste(query);
}

/** The live filter toggle; the group also renders an aria-hidden copy it measures. */
export function filterButton(label: string) {
  const [live] = screen
    .getAllByLabelText(label)
    .filter((button) => !button.closest('[aria-hidden="true"]'));
  return live;
}

export function expectFocusName(pattern: RegExp) {
  expect(document.activeElement?.getAttribute("aria-label") ?? "").toMatch(pattern);
}

/** Filters to Bold and opens its Voice commands from the row, by keyboard. */
export async function openBoldVoice() {
  const { user } = await openEditor();
  await focusRow(user, "editor.bold");
  for (let press = 0; press < 8; press += 1) {
    if (
      /^shortcutEditor\.voice\.open/.test(document.activeElement?.getAttribute("aria-label") ?? "")
    )
      break;
    await user.keyboard("{ArrowRight}");
  }
  expectFocusName(/^shortcutEditor\.voice\.open/);
  const opener = document.activeElement as HTMLElement;
  await user.keyboard("{Enter}");
  const dialog = await findDialogTitled('shortcutEditor.voice.title {"command":"editor.bold"}');
  const field = within(dialog).getByRole("textbox", { name: /shortcutEditor\.voice\.addLabel/ });
  return { user, dialog, opener, field };
}

beforeEach(() => {
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
  useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
  file.save.mockClear();
  file.pick.mockReset();
});
