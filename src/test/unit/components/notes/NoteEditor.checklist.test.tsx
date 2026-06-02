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
        "notes.titlePlaceholder": "Note title",
        "notes.bodyPlaceholder": "Start writing...",
        "notes.collapseHeading": "Collapse heading",
        "notes.expandHeading": "Expand heading",
        "notes.pin": "Pin",
        "notes.unpin": "Unpin",
        "notes.addTag": "Add tag",
        "notes.tags": "Tags",
      };
      return map[key] ?? key;
    },
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ alwaysOnTop: false, setAlwaysOnTop: vi.fn() }),
}));

vi.mock("../../../../components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

vi.mock("../../../../lib/platform", () => ({
  IS_TAURI: false,
}));

vi.mock("../../../../components/editor", () => ({
  Editor: (props: { headerContent?: React.ReactNode }) => (
    <div>
      {props.headerContent}
      {mockEditor(props)}
    </div>
  ),
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

describe("NoteEditor extensions", () => {
  it("passes task-list and collapsible-heading extensions to the shared Editor", () => {
    render(
      <NoteEditor
        note={buildNote({})}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onBack={vi.fn()}
      />,
    );

    const props = mockEditor.mock.calls[0]?.[0] as {
      extraExtensions?: unknown[];
    };

    expect(Array.isArray(props?.extraExtensions)).toBe(true);
    expect(props.extraExtensions).toHaveLength(4);

    const taskItemExtension = props.extraExtensions?.[1] as {
      options?: {
        nested?: boolean;
      };
      config?: {
        draggable?: boolean;
        addNodeView?: () => unknown;
      };
    };
    const taskDndBehavior = props.extraExtensions?.[2] as {
      config?: {
        addProseMirrorPlugins?: () => unknown;
      };
    };
    const collapsibleHeading = props.extraExtensions?.[3] as {
      options?: {
        collapseLabel?: string;
        expandLabel?: string;
      };
      config?: {
        addProseMirrorPlugins?: () => unknown;
      };
    };
    expect(taskItemExtension.options?.nested).toBe(true);
    expect(taskItemExtension.config?.draggable).toBe(true);
    expect(typeof taskItemExtension.config?.addNodeView).toBe("function");
    expect(typeof taskDndBehavior.config?.addProseMirrorPlugins).toBe("function");
    expect(collapsibleHeading.options).toMatchObject({
      collapseLabel: "Collapse heading",
      expandLabel: "Expand heading",
    });
    expect(typeof collapsibleHeading.config?.addProseMirrorPlugins).toBe("function");
  });
});
