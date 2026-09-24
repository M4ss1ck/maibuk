import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteListItem } from "@/components/notes/NoteListItem";
import { mockItemMenuLayout } from "@/test/support/item-menu-layout";
import type { Note } from "@/features/notes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
}));

function buildNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    bookId: null,
    title: "Old title",
    content: "<p>Preview</p>",
    language: "en",
    tags: [],
    order: 0,
    wordCount: 1,
    createdAt: 1,
    updatedAt: 1,
    contentUpdatedAt: 1,
    pinned: false,
    collapsedHeadings: [],
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("NoteListItem title editing", () => {
  it("positions the Item Menu beside the Note row with its desktop button hidden", async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <NoteListItem note={buildNote()} isSelected={false} onSelect={onSelect} onRename={vi.fn()} />
    );
    mockItemMenuLayout(container);
    fireEvent.contextMenu(screen.getByText("Old title"), { clientX: 400, clientY: 250 });
    const menu = await screen.findByRole("menu");
    await waitFor(() =>
      expect(menu.closest("[data-placement]")).toHaveStyle({ left: "380px", top: "384px" })
    );
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("saves a renamed note title from the sidebar row", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const note = buildNote();

    render(
      <ul>
        <NoteListItem note={note} isSelected={false} onSelect={vi.fn()} onRename={onRename} />
      </ul>
    );

    await user.click(screen.getByRole("button", { name: "common.moreActionsFor" }));
    await user.click(await screen.findByRole("menuitem", { name: "common.rename" }));
    const input = screen.getByDisplayValue("Old title");
    await waitFor(() => expect(input).toHaveFocus());

    await user.clear(input);
    await user.type(input, "New title{Enter}");

    expect(onRename).toHaveBeenCalledWith(note, "New title");
  });

  it("renames by keyboard from the item menu and keeps focus in the title field", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const note = buildNote();

    render(
      <ul>
        <NoteListItem note={note} isSelected={false} onSelect={vi.fn()} onRename={onRename} />
      </ul>
    );

    screen.getByRole("button", { name: "common.moreActionsFor" }).focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "common.rename" })).toHaveFocus()
    );
    await user.keyboard("{Enter}");

    const input = screen.getByDisplayValue("Old title");
    await waitFor(() => expect(input).toHaveFocus());
    await user.keyboard("{Control>}a{/Control}Keyboard title{Enter}");

    expect(onRename).toHaveBeenCalledWith(note, "Keyboard title");
  });
});
