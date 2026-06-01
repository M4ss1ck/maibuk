import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoteEditor } from "../../../../components/notes/NoteEditor";
import type { Note } from "../../../../features/notes";

const { mockEditor } = vi.hoisted(() => ({
  mockEditor: vi.fn((_: unknown) => <div />),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "common.back": "Back",
        "common.words": "words",
        "notes.saving": "Saving",
        "notes.saved": "Saved",
        "notes.delete": "Delete note",
        "notes.deleteConfirm": "Delete this note?",
        "notes.titlePlaceholder": "Note title",
        "notes.bodyPlaceholder": "Start writing...",
        "notes.pin": "Pin",
        "notes.unpin": "Unpin",
        "notes.addTag": "Add tag",
        "notes.tags": "Tags",
      };
      return map[key] ?? key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../components/editor", () => ({
  Editor: (props: unknown) => mockEditor(props),
}));

vi.mock("../../../../features/notes/store", () => ({
  useNoteStore: (selector: (state: { notes: Note[] }) => unknown) => selector({ notes: [] }),
}));

function buildNote(overrides: Partial<Note>): Note {
  return {
    id: overrides.id ?? "note-1",
    title: overrides.title ?? "Initial",
    content: overrides.content ?? "<p>Initial body</p>",
    tags: overrides.tags ?? [],
    pinned: overrides.pinned ?? false,
    order: overrides.order ?? 0,
    wordCount: overrides.wordCount ?? 10,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

describe("NoteEditor checklist extensions", () => {
  it("passes task-list extensions to the shared Editor", () => {
    render(
      <NoteEditor
        note={buildNote({})}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    const props = mockEditor.mock.calls[0]?.[0] as {
      extraExtensions?: unknown[];
    };

    expect(Array.isArray(props?.extraExtensions)).toBe(true);
    expect(props.extraExtensions).toHaveLength(2);

    const taskItemExtension = props.extraExtensions?.[1] as {
      options?: {
        nested?: boolean;
        HTMLAttributes?: { draggable?: string };
      };
    };
    expect(taskItemExtension.options?.nested).toBe(true);
    expect(taskItemExtension.options?.HTMLAttributes?.draggable).toBe("true");
  });
});
