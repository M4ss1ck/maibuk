import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoteFilterPopover } from "@/components/notes/NoteFilterPopover";
import { DEFAULT_NOTES_FILTERS, type NoteWithBook } from "@/components/notes/notes-list-model";
import { useSettingsStore } from "@/features/settings/store";
import { useNoteFilter } from "@/hooks/useNoteFilter";
import { installPointerEvent } from "@/test/support/pointer-events";

installPointerEvent();

vi.mock("../../../../lib/platform", () => ({
  IS_ANDROID: false,
  IS_TAURI: false,
  IS_DESKTOP: false,
  getFileSystem: vi.fn(),
  getOS: vi.fn(async () => ({ locale: vi.fn(async () => "en") })),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number; tag?: string }) => {
      const map: Record<string, string> = {
        "notes.advancedFilters": "Filters",
        "notes.clearFilters": "Clear filters",
        "notes.tagFilter": "Tag",
        "notes.tagFilterHelp": "Shows only notes that have all of these tags",
        "notes.excludeTagFilter": "Exclude tags",
        "notes.excludeTagFilterHelp": "Hides notes that have any of these tags",
        "notes.anyTag": "Any tag",
        "notes.noExcludedTags": "No excluded tags",
        "notes.dateFrom": "Updated from",
        "notes.dateTo": "Updated to",
        "notes.clearDate": "Clear date",
        "notes.previousMonth": "Previous month",
        "notes.nextMonth": "Next month",
      };

      if (key === "notes.filtersActive") {
        return `Filters, ${params?.count ?? 0} active`;
      }
      if (key === "notes.removeTag") return `Remove ${params?.tag}`;
      if (key === "notes.removeExcludedTag") return `Stop excluding ${params?.tag}`;
      return map[key] ?? key;
    },
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

function note(id: string, tags: string[]): NoteWithBook {
  return {
    id,
    title: id,
    content: "",
    language: "en",
    tags,
    pinned: false,
    order: 0,
    wordCount: 0,
    collapsedHeadings: [],
    createdAt: 1,
    updatedAt: 1,
    contentUpdatedAt: 1,
  };
}

const notes = [note("a", ["task", "draft"]), note("b", ["revision"])];

function FilterHarness() {
  const filter = useNoteFilter(notes);
  const [isOpen, setOpen] = useState(false);
  return <NoteFilterPopover filter={filter} isOpen={isOpen} onOpenChange={setOpen} />;
}

const trigger = (name: string) => screen.getByRole("button", { name });

async function openFromKeyboard(user: ReturnType<typeof userEvent.setup>) {
  const button = trigger("Filters");
  button.focus();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(screen.getByPlaceholderText("Any tag")).toHaveFocus());
  return button;
}

describe("NoteFilterPopover", () => {
  beforeEach(() => {
    useSettingsStore.setState({ notesFilters: DEFAULT_NOTES_FILTERS });
  });

  it("opens from the trigger with Enter and focuses the include-Tags combobox", async () => {
    const user = userEvent.setup();
    render(<FilterHarness />);

    await openFromKeyboard(user);

    expect(screen.getByPlaceholderText("Any tag")).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();
  });

  it("Space on an include Tag's checkbox narrows to it, by keyboard alone", async () => {
    const user = userEvent.setup();
    render(<FilterHarness />);
    await openFromKeyboard(user);

    // ArrowDown enters the include list at its first option, "draft".
    await user.keyboard("{ArrowDown}");
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(within(dialog).getByRole("checkbox", { name: "draft" })).toHaveFocus();
    await user.keyboard(" ");

    expect(useSettingsStore.getState().notesFilters.tags).toEqual(["draft"]);
    expect(useSettingsStore.getState().notesFilters.excludeTags).toEqual([]);
  });

  it("choosing an exclude Tag persists it and names the trigger with the count", async () => {
    const user = userEvent.setup();
    render(<FilterHarness />);
    await openFromKeyboard(user);

    const excludeInput = screen.getByPlaceholderText("No excluded tags");
    await user.click(excludeInput);
    await user.type(excludeInput, "task");
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    await user.click(within(dialog).getByRole("checkbox", { name: "task" }));

    expect(useSettingsStore.getState().notesFilters.excludeTags).toEqual(["task"]);

    // The first Escape closes the exclude list, the second the Popover. The
    // open Popover hides the page from assistive technology, so the trigger
    // is read by name once it is back on screen.
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger("Filters, 1 active")).toBeInTheDocument());
  });

  it("Escape closes the open Tag list first, then the Popover, returning focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<FilterHarness />);
    const button = await openFromKeyboard(user);
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(within(dialog).getByRole("checkbox", { name: "draft" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(within(dialog).queryByRole("checkbox", { name: "draft" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Any tag")).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByPlaceholderText("Any tag")).not.toBeInTheDocument());
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("Tab from the include field closes its list and moves to the exclude field's help", async () => {
    const user = userEvent.setup();
    render(<FilterHarness />);
    await openFromKeyboard(user);
    const dialog = screen.getByRole("dialog", { name: "Filters" });

    await user.tab();

    expect(
      within(dialog).getByRole("button", { name: "Hides notes that have any of these tags" })
    ).toHaveFocus();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("Escape with the date calendar open closes only the calendar", async () => {
    const user = userEvent.setup();
    render(<FilterHarness />);
    await openFromKeyboard(user);

    await user.click(screen.getByRole("button", { name: "Updated from" }));
    expect(screen.getByRole("button", { name: "Previous month" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Previous month" })).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("Clear filters empties the criteria and keeps the Popover open", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({
      notesFilters: { ...DEFAULT_NOTES_FILTERS, excludeTags: ["task"] },
    });
    render(<FilterHarness />);

    const button = trigger("Filters, 1 active");
    button.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByPlaceholderText("Any tag")).toHaveFocus());

    const clear = screen.getByRole("button", { name: "Clear filters" });
    while (document.activeElement !== clear) await user.tab();
    await user.keyboard("{Enter}");

    expect(useSettingsStore.getState().notesFilters).toEqual(DEFAULT_NOTES_FILTERS);
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();
    expect(clear).toBeDisabled();
    // The pressed button disabled itself, so focus went back to the first
    // field instead of falling out of the Popover.
    expect(screen.getByPlaceholderText("Any tag")).toHaveFocus();

    // Focus opened the include list: Escape closes it, then the Popover.
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger("Filters")).toHaveFocus());
  });

  it("Clear filters is disabled while no criterion is set", async () => {
    const user = userEvent.setup();
    render(<FilterHarness />);
    await openFromKeyboard(user);

    expect(screen.getByRole("button", { name: "Clear filters" })).toBeDisabled();
  });
});
