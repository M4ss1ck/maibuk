import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildChapter } from "@/test/support/fixtures";
import type { Chapter } from "@/features/chapters/types";
import type { DropItem } from "react-aria-components/useDragAndDrop";

const {
  storeState,
  i18nState,
  mockSetChapterListView,
  mockSetShowChapterOutline,
  mockToastError,
  textFileDropOptions,
} = vi.hoisted(
  () => ({
    storeState: { chapterListView: "normal" as "normal" | "compact", showChapterOutline: false },
    i18nState: { language: "en" },
    mockSetChapterListView: vi.fn(),
    mockSetShowChapterOutline: vi.fn(),
    mockToastError: vi.fn(),
    textFileDropOptions: { current: null as Record<string, unknown> | null },
  }),
);

vi.mock("@/components/ui/Toast", () => ({
  toast: { error: mockToastError },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      i18nState.language === "es" && key === "chapters.reorder" ? "Reordenar" : key,
    i18n: { language: i18nState.language, resolvedLanguage: i18nState.language },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/hooks/useTextFileDrop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useTextFileDrop")>();
  return {
    ...actual,
    useTextFileDrop: (_ref: unknown, options: Record<string, unknown>) => {
      textFileDropOptions.current = options;
      return {
        isDraggingFile: false,
        isImportingFiles: false,
        dropHandlers: {
          onDrop: (event: { preventDefault: () => void }) => {
            event.preventDefault();
            return (options.onImport as (
              files: Array<{ text: string; stem: string; extension: string }>,
              point: { x: number; y: number },
            ) => void)(
              [{ text: "# Empty import", stem: "empty-import", extension: ".md" }],
              { x: 10, y: 20 },
            );
          },
        },
      };
    },
  };
});

vi.mock("@/components/editor/ChapterOutline", () => ({
  ChapterOutline: () => <div data-testid="chapter-outline" />,
}));

vi.mock("@/features/settings/store", () => ({
  useSettingsStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const fullState = {
      chapterListView: storeState.chapterListView,
      showChapterOutline: storeState.showChapterOutline,
      setChapterListView: mockSetChapterListView,
      setShowChapterOutline: mockSetShowChapterOutline,
    };
    return selector ? selector(fullState) : fullState;
  },
}));

import { ChapterList, readChapterDropItems } from "@/components/editor/ChapterList";

function fileDropItem(name: string, text: string): DropItem {
  return {
    kind: "file",
    name,
    type: "",
    getText: async () => text,
    getFile: async () => new File([text], name),
  } as DropItem;
}

function buildChapters(count: number): Chapter[] {
  return Array.from({ length: count }, (_, i) =>
    buildChapter({
      id: `ch-${i + 1}`,
      title: `Chapter ${i + 1}`,
      order: i + 1,
      wordCount: 100 * (i + 1),
    })
  );
}

const defaultChapters = buildChapters(3);

function makeProps(overrides = {}) {
  return {
    chapters: defaultChapters,
    currentChapterId: defaultChapters[0].id,
    onSelectChapter: vi.fn(),
    onCreateChapter: vi.fn(),
    onUpdateChapter: vi.fn(),
    onDeleteChapter: vi.fn(),
    onReorderChapters: vi.fn(),
    ...overrides,
  };
}

function renderCL(overrides = {}) {
  return render(<ChapterList {...makeProps(overrides)} />);
}

function ReorderHarness({
  initialChapters,
  onReorder,
}: {
  initialChapters: Chapter[];
  onReorder: (chapterIds: string[]) => void;
}) {
  const [chapters, setChapters] = useState(initialChapters);

  return (
    <ChapterList
      {...makeProps({
        chapters,
        currentChapterId: initialChapters[0]?.id ?? null,
        onReorderChapters: (chapterIds: string[]) => {
          onReorder(chapterIds);
          setChapters(chapterIds.map((id) => chapters.find((chapter) => chapter.id === id)!));
        },
      })}
    />
  );
}

function DeleteHarness({
  initialChapters,
  onDelete,
}: {
  initialChapters: Chapter[];
  onDelete: (chapterId: string) => void;
}) {
  const [chapters, setChapters] = useState(initialChapters);
  const [currentChapterId, setCurrentChapterId] = useState(initialChapters[0]?.id ?? null);

  return (
    <ChapterList
      {...makeProps({
        chapters,
        currentChapterId,
        onDeleteChapter: (chapterId: string) => {
          onDelete(chapterId);
          const remaining = chapters.filter((chapter) => chapter.id !== chapterId);
          setChapters(remaining);
          setCurrentChapterId(remaining[0]?.id ?? null);
        },
      })}
    />
  );
}

async function tabToControl(user: ReturnType<typeof userEvent.setup>, control: HTMLElement) {
  for (let index = 0; index < 10 && document.activeElement !== control; index++) {
    await user.tab();
  }
  expect(control).toHaveFocus();
}

async function arrowToDropTarget(user: ReturnType<typeof userEvent.setup>, accessibleName: string) {
  for (
    let index = 0;
    index < 10 && document.activeElement?.getAttribute("aria-label") !== accessibleName;
    index++
  ) {
    await user.keyboard("{ArrowDown}");
  }
  expect(document.activeElement).toHaveAccessibleName(accessibleName);
}

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  const items: Array<{ kind: "string"; type: string }> & {
    add: (value: string, type: string) => void;
    clear: () => void;
    remove: (index: number) => void;
  } = Object.assign([], {
    add(value: string, type: string) {
      values.set(type, value);
      if (!items.some((item) => item.type === type)) items.push({ kind: "string", type });
    },
    clear() {
      items.splice(0);
      values.clear();
    },
    remove(index: number) {
      const [item] = items.splice(index, 1);
      if (item) values.delete(item.type);
    },
  });

  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: items as unknown as DataTransferItemList,
    get types() {
      return items.map((item) => item.type);
    },
    clearData(type?: string) {
      if (type) {
        const index = items.findIndex((item) => item.type === type);
        if (index >= 0) items.remove(index);
      } else {
        items.clear();
      }
    },
    getData(type: string) {
      return values.get(type) ?? "";
    },
    setData(type: string, value: string) {
      items.add(value, type);
    },
    setDragImage() {},
  } as DataTransfer;
}

function createFileDataTransfer(file: File): DataTransfer {
  const item = {
    kind: "file",
    type: file.type,
    getAsFile: () => file,
  } as DataTransferItem;

  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: [file] as unknown as FileList,
    items: [item] as unknown as DataTransferItemList,
    types: ["Files"],
    clearData() {},
    getData: () => "",
    setData() {},
    setDragImage() {},
  } as DataTransfer;
}

function mockRect(element: HTMLElement, top: number, bottom: number) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    top,
    bottom,
    left: 0,
    right: 400,
    width: 400,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
}

function mockGridLayout() {
  const grid = screen.getByRole("grid");
  const rows = screen.getAllByRole("row");
  mockRect(grid, 0, rows.length * 50 - 10);
  rows.forEach((row, index) => {
    mockRect(row, index * 50, index * 50 + 40);
  });
  return { grid, rows };
}

function dispatchDragEvent(element: Element, type: string, dt: DataTransfer, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: dt },
    clientX: { value: 10 },
    clientY: { value: clientY },
    altKey: { value: false },
    ctrlKey: { value: false },
    metaKey: { value: false },
    shiftKey: { value: false },
  });
  fireEvent(element, event);
}

describe("ChapterList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    storeState.chapterListView = "normal";
    storeState.showChapterOutline = false;
    i18nState.language = "en";
    textFileDropOptions.current = null;
  });

  // ---------------------------------------------------------------------------
  describe("keyboard DnD reorder", () => {
    it("cancels keyboard reorder with Escape", async () => {
      const user = userEvent.setup();
      const onReorder = vi.fn();
      const chapters = [
        buildChapter({ id: "ch-1", title: "First", order: 1 }),
        buildChapter({ id: "ch-2", title: "Second", order: 2 }),
      ];
      renderCL({ chapters, currentChapterId: chapters[0].id, onReorderChapters: onReorder });

      const dragButtons = screen.getAllByRole("button", { name: "chapters.reorder" });
      dragButtons[0].focus();

      await user.keyboard("{Enter}");
      await user.keyboard("{ArrowDown}");
      await user.keyboard("{Escape}");

      expect(onReorder).not.toHaveBeenCalled();
      expect(dragButtons[0]).toHaveFocus();
      await waitFor(() => expect(screen.getByRole("grid")).toBeInTheDocument());
    });

    it("reorders chapters via keyboard drag-and-drop", async () => {
      const user = userEvent.setup();
      const onReorder = vi.fn();
      const chapters = [
        buildChapter({ id: "ch-1", title: "First", order: 1 }),
        buildChapter({ id: "ch-2", title: "Second", order: 2 }),
        buildChapter({ id: "ch-3", title: "Third", order: 3 }),
      ];
      render(<ReorderHarness initialChapters={chapters} onReorder={onReorder} />);

      const dragButtons = screen.getAllByRole("button", { name: "chapters.reorder" });
      dragButtons[0].focus();

      await user.keyboard("{Enter}");
      await arrowToDropTarget(user, "Insert between Second and Third");
      await user.keyboard("{Enter}");

      expect(onReorder).toHaveBeenCalledTimes(1);
      expect(onReorder).toHaveBeenCalledWith(["ch-2", "ch-1", "ch-3"]);
      expect(screen.getByRole("row", { name: "First" })).toHaveFocus();
    });
  });

  // ---------------------------------------------------------------------------
  describe("keyboard navigation (rows)", () => {
    it("ArrowDown/ArrowUp navigate between rows", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderCL({ onSelectChapter: onSelect });
      const rows = screen.getAllByRole("row");
      rows[0].focus();
      expect(rows[0]).toHaveFocus();

      await user.keyboard("{ArrowDown}");
      expect(rows[1]).toHaveFocus();
      expect(onSelect).not.toHaveBeenCalled();

      await user.keyboard("{ArrowUp}");
      expect(rows[0]).toHaveFocus();
    });

    it("End goes to last row", async () => {
      const user = userEvent.setup();
      renderCL();
      const rows = screen.getAllByRole("row");
      rows[0].focus();
      await user.keyboard("{End}");
      expect(rows[rows.length - 1]).toHaveFocus();
    });

    it("Home goes to first row", async () => {
      const user = userEvent.setup();
      renderCL();
      const rows = screen.getAllByRole("row");
      rows[1].focus();
      await user.keyboard("{Home}");
      expect(rows[0]).toHaveFocus();
    });

    it("typeahead jumps to matching chapter", async () => {
      const user = userEvent.setup();
      const chapters = [
        buildChapter({ id: "ch-alpha", title: "Alpha", order: 1 }),
        buildChapter({ id: "ch-beta", title: "Beta", order: 2 }),
        buildChapter({ id: "ch-gamma", title: "Gamma", order: 3 }),
      ];
      renderCL({ chapters, currentChapterId: chapters[0].id });
      const rows = screen.getAllByRole("row");
      rows[0].focus();

      await user.keyboard("g");
      expect(rows[2]).toHaveFocus();
    });
  });

  // ---------------------------------------------------------------------------
  describe("activation", () => {
    it("Enter activates the focused row", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const chapters = buildChapters(3);
      renderCL({ chapters, currentChapterId: chapters[0].id, onSelectChapter: onSelect });
      const rows = screen.getAllByRole("row");
      rows[0].focus();
      await user.keyboard("{ArrowDown}");
      expect(rows[1]).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: chapters[1].id }));
    });

    it("Space activates the focused row", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const chapters = buildChapters(3);
      renderCL({ chapters, currentChapterId: chapters[0].id, onSelectChapter: onSelect });
      const rows = screen.getAllByRole("row");
      rows[1].focus();
      await user.keyboard(" ");
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: chapters[1].id }));
    });

    it("Space activates the already-current focused row", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const chapters = buildChapters(2);
      renderCL({ chapters, currentChapterId: chapters[0].id, onSelectChapter: onSelect });
      const currentRow = screen.getAllByRole("row")[0];
      currentRow.focus();

      await user.keyboard(" ");

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: chapters[0].id }));
    });

    it("pointer activation selects the clicked row", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const chapters = buildChapters(2);
      renderCL({ chapters, currentChapterId: chapters[0].id, onSelectChapter: onSelect });

      await user.click(screen.getAllByRole("row")[1]);

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: chapters[1].id }));
    });

    it("pointer activation selects the already-current row", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const chapters = buildChapters(2);
      renderCL({ chapters, currentChapterId: chapters[0].id, onSelectChapter: onSelect });

      await user.click(screen.getAllByRole("row")[0]);

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: chapters[0].id }));
    });

    it("unrelated keys and Escape do NOT call onSelectChapter", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderCL({ onSelectChapter: onSelect });
      const rows = screen.getAllByRole("row");
      rows[0].focus();
      await user.keyboard("{a}");
      await user.keyboard("{Escape}");
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  describe("Tab navigation to nested controls", () => {
    it("Tab reaches drag handle, edit, delete, and outline controls", async () => {
      const user = userEvent.setup();
      const chapters = [buildChapter({ id: "ch-1", title: "First", order: 1 })];
      renderCL({ chapters, currentChapterId: chapters[0].id, editor: { state: {} } });

      const rows = screen.getAllByRole("row");
      rows[0].focus();

      await user.tab();
      const dragBtn = screen.getByRole("button", { name: "chapters.reorder" });
      expect(dragBtn).toHaveFocus();

      await user.tab();
      const editBtn = screen.getByRole("button", { name: "chapters.editChapter" });
      expect(editBtn).toHaveFocus();

      await user.tab();
      const delBtn = screen.getByRole("button", { name: "chapters.deleteChapter" });
      expect(delBtn).toHaveFocus();

      await user.tab();
      expect(screen.getByRole("button", { name: "toc.showOutline" })).toHaveFocus();
    });

    it("pressing the edit button shows the edit form", async () => {
      const user = userEvent.setup();
      const chapters = [buildChapter({ id: "ch-1", title: "First", order: 1 })];
      renderCL({ chapters, currentChapterId: chapters[0].id });

      const editBtn = screen.getByRole("button", { name: "chapters.editChapter" });
      editBtn.focus();
      expect(editBtn).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(screen.getByDisplayValue("First")).toBeInTheDocument();
    });

    it("pressing the delete button shows confirmation", async () => {
      const user = userEvent.setup();
      const chapters = [buildChapter({ id: "ch-1", title: "First", order: 1 })];
      renderCL({ chapters, currentChapterId: chapters[0].id });

      const delBtn = screen.getByRole("button", { name: "chapters.deleteChapter" });
      delBtn.focus();
      await user.keyboard("{Enter}");
      expect(screen.getByText("common.deleteConfirm")).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  describe("inline create", () => {
    it("opens create form from the keyboard", async () => {
      const user = userEvent.setup();
      renderCL();
      const addButton = screen.getByRole("button", { name: "chapters.addChapter" });
      addButton.focus();
      await user.keyboard("{Enter}");
      expect(screen.getByPlaceholderText("chapters.chapterTitlePlaceholder")).toBeInTheDocument();
    });

    it("submits create on Enter", async () => {
      const user = userEvent.setup();
      const onCreate = vi.fn();
      renderCL({ onCreateChapter: onCreate });
      await user.click(screen.getByRole("button", { name: "chapters.addChapter" }));
      const input = screen.getByPlaceholderText("chapters.chapterTitlePlaceholder");
      await user.type(input, "New Chapter{Enter}");
      expect(onCreate).toHaveBeenCalledWith("New Chapter", "chapter");
    });

    it("cancels create on Escape", async () => {
      const user = userEvent.setup();
      renderCL();
      await user.click(screen.getByRole("button", { name: "chapters.addChapter" }));
      const input = screen.getByPlaceholderText("chapters.chapterTitlePlaceholder");
      await user.type(input, "Temp{Escape}");
      expect(
        screen.queryByPlaceholderText("chapters.chapterTitlePlaceholder")
      ).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  describe("inline edit", () => {
    it("submits edit on Enter via edit form Save button", async () => {
      const user = userEvent.setup();
      const onUpdate = vi.fn();
      const chapters = [buildChapter({ id: "ch-1", title: "First", order: 1 })];
      renderCL({ chapters, currentChapterId: chapters[0].id, onUpdateChapter: onUpdate });

      const editBtn = screen.getByRole("button", { name: "chapters.editChapter" });
      await user.click(editBtn);

      const input = screen.getByDisplayValue("First");
      await user.clear(input);
      await user.type(input, "Updated Title{Enter}");

      expect(onUpdate).toHaveBeenCalledWith("ch-1", "Updated Title", "chapter");
    });

    it("cancels edit on Escape from edit form", async () => {
      const user = userEvent.setup();
      const chapters = [buildChapter({ id: "ch-1", title: "First", order: 1 })];
      renderCL({ chapters, currentChapterId: chapters[0].id });

      const editBtn = screen.getByRole("button", { name: "chapters.editChapter" });
      await user.click(editBtn);

      await user.keyboard("{Escape}");

      expect(screen.queryByDisplayValue("First")).not.toBeInTheDocument();
      expect(screen.getByText("First")).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  describe("delete confirmation", () => {
    it("confirms delete by keyboard (Tab to Yes, Enter)", async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn();
      const chapters = [
        buildChapter({ id: "ch-1", title: "First", order: 1 }),
        buildChapter({ id: "ch-2", title: "Second", order: 2 }),
      ];
      render(<DeleteHarness initialChapters={chapters} onDelete={onDelete} />);

      const deleteButton = screen.getAllByRole("button", { name: "chapters.deleteChapter" })[0];
      deleteButton.focus();
      await user.keyboard("{Enter}");
      const yesButton = screen.getByRole("button", { name: "common.yes" });
      await tabToControl(user, yesButton);
      await user.keyboard("{Enter}");
      expect(onDelete).toHaveBeenCalledWith("ch-1");
      await waitFor(() => expect(screen.getByRole("row", { name: "Second" })).toHaveFocus());
    });

    it("cancels delete by keyboard (Tab to No, Enter) and focus returns", async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn();
      const chapters = [buildChapter({ id: "ch-1", title: "First", order: 1 })];
      renderCL({ chapters, currentChapterId: chapters[0].id, onDeleteChapter: onDelete });

      const deleteButton = screen.getByRole("button", { name: "chapters.deleteChapter" });
      deleteButton.focus();
      await user.keyboard("{Enter}");
      const noButton = screen.getByRole("button", { name: "common.no" });
      await tabToControl(user, noButton);
      await user.keyboard("{Enter}");

      expect(onDelete).not.toHaveBeenCalled();
      expect(screen.queryByText("common.deleteConfirm")).not.toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "chapters.deleteChapter" })).toHaveFocus();
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe("compact/normal toggle", () => {
    it("toggles to compact view", async () => {
      const user = userEvent.setup();
      renderCL();
      const toggle = screen.getByRole("button", { name: "chapters.switchToCompactView" });
      toggle.focus();
      await user.keyboard("{Enter}");
      expect(mockSetChapterListView).toHaveBeenCalledWith("compact");
    });

    it("toggles to normal view when in compact", async () => {
      const user = userEvent.setup();
      storeState.chapterListView = "compact";
      renderCL();
      const toggle = screen.getByRole("button", { name: "chapters.switchToNormalView" });
      toggle.focus();
      await user.keyboard("{Enter}");
      expect(mockSetChapterListView).toHaveBeenCalledWith("normal");
    });
  });

  // ---------------------------------------------------------------------------
  describe("current chapter styling", () => {
    it("highlights the active chapter row", () => {
      renderCL();
      const rows = screen.getAllByRole("row");
      expect(rows[0].getAttribute("aria-selected")).toBe("true");
    });

    it("does not highlight non-active rows", () => {
      renderCL();
      const rows = screen.getAllByRole("row");
      expect(rows[1].getAttribute("aria-selected")).toBe("false");
    });

    it("preserves active-row styling and normal density", () => {
      renderCL();
      const activeRow = screen.getAllByRole("row")[0];
      expect(activeRow).toHaveClass("bg-primary/10", "border-l-2", "border-primary");
      expect(screen.getByText("Chapter 1").parentElement?.parentElement).toHaveClass("p-3");
    });

    it("preserves compact density", () => {
      storeState.chapterListView = "compact";
      renderCL();
      expect(screen.getByText("Chapter 1").parentElement?.parentElement).toHaveClass(
        "px-2",
        "py-1.5"
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe("outline rendering", () => {
    it("shows outline toggle only on active chapter", () => {
      renderCL({ editor: { state: {} } });
      expect(screen.getAllByRole("button", { name: "toc.showOutline" })).toHaveLength(1);
    });

    it("activates the outline toggle by keyboard", async () => {
      const user = userEvent.setup();
      renderCL({ editor: { state: {} } });
      const outlineButton = screen.getByRole("button", { name: "toc.showOutline" });
      outlineButton.focus();
      await user.keyboard("{Enter}");
      expect(mockSetShowChapterOutline).toHaveBeenCalledWith(true);
    });

    it("exposes outline toggle state and renders the outline when enabled", () => {
      storeState.showChapterOutline = true;
      renderCL({ editor: { state: {} } });
      expect(screen.getByRole("button", { name: "toc.hideOutline" })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
      expect(screen.getByTestId("chapter-outline")).toBeInTheDocument();
    });

    it("renders the outline inside the active chapter row, not at the bottom of the list", () => {
      storeState.showChapterOutline = true;
      renderCL({ editor: { state: {} } });
      const rows = screen.getAllByRole("row");
      expect(within(rows[0]).getByTestId("chapter-outline")).toBeInTheDocument();
    });

    it("does not show outline toggle on inactive chapters", () => {
      renderCL({ editor: { state: {} }, currentChapterId: defaultChapters[0].id });
      const rows = screen.getAllByRole("row");
      expect(
        within(rows[0]).queryByRole("button", { name: "toc.showOutline" })
      ).toBeInTheDocument();
      expect(
        within(rows[1]).queryByRole("button", { name: "toc.showOutline" })
      ).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  describe("external markdown file drop", () => {
    it("reads supported file drop items in order and skips others", async () => {
      const items = [
        fileDropItem("one.md", "# One"),
        fileDropItem("skip.png", "binary"),
        fileDropItem("two.txt", "plain"),
      ];
      const files = await readChapterDropItems(items);
      expect(files.map((file) => file.stem)).toEqual(["one", "two"]);
    });

    it("renders the grid when onImportFiles is provided", () => {
      renderCL({ onImportFiles: vi.fn() });
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    it("imports a web file at the root when the chapter list is empty", () => {
      const onImportFiles = vi.fn();
      renderCL({ chapters: [], currentChapterId: null, onImportFiles });

      expect(textFileDropOptions.current).toMatchObject({ disableWeb: false });
      fireEvent.drop(screen.getByRole("grid").parentElement as HTMLElement);

      expect(onImportFiles).toHaveBeenCalledWith(
        [{ text: "# Empty import", stem: "empty-import", extension: ".md" }],
        null,
      );
    });

    it("uses native drop coordinates without rendering a second insertion line", () => {
      const onImportFiles = vi.fn();
      renderCL({ onImportFiles });
      const grid = screen.getByRole("grid");
      const rows = screen.getAllByRole("row");
      mockRect(grid.parentElement as HTMLElement, 0, 140);
      rows.forEach((row, index) => {
        mockRect(row, index * 50, index * 50 + 40);
      });

      expect(textFileDropOptions.current).toMatchObject({ disableWeb: true });
      expect(textFileDropOptions.current).not.toHaveProperty("onDragMove");
      expect(screen.queryByTestId("chapter-file-drop-line")).not.toBeInTheDocument();

      const files = [{ text: "# Imported", stem: "imported", extension: ".md" }];
      act(() => {
        const onImport = textFileDropOptions.current?.onImport as
          | ((droppedFiles: typeof files, point: { x: number; y: number }) => void)
          | undefined;
        onImport?.(files, { x: 10, y: 75 });
      });

      expect(onImportFiles).toHaveBeenCalledWith(files, { id: "ch-2", placement: "after" });
    });

    it.each([
      { clientY: 55, placement: "before" as const },
      { clientY: 85, placement: "after" as const },
    ])(
      "renders one React Aria divider and imports $placement the hovered row",
      async ({ clientY, placement }) => {
        const onImportFiles = vi.fn();
        renderCL({ onImportFiles });
        const { grid } = mockGridLayout();
        const dataTransfer = createFileDataTransfer(
          new File(["# Imported"], "imported.md", { type: "text/markdown" }),
        );

        dispatchDragEvent(grid, "dragenter", dataTransfer, clientY);
        dispatchDragEvent(grid, "dragover", dataTransfer, clientY);

        await waitFor(() => {
          const indicators = document.querySelectorAll("[data-drop-target]");
          expect(indicators).toHaveLength(1);
          expect(indicators[0]).toHaveClass("h-0.5", "bg-primary");
        });
        expect(screen.queryByTestId("chapter-file-drop-line")).not.toBeInTheDocument();

        dispatchDragEvent(grid, "drop", dataTransfer, clientY);

        await waitFor(() => {
          expect(onImportFiles).toHaveBeenCalledWith(
            [expect.objectContaining({ text: "# Imported", stem: "imported" })],
            { id: "ch-2", placement },
          );
        });
      },
    );

    it("shows import status until a React Aria file import finishes persisting", async () => {
      let finishImport: (() => void) | undefined;
      const onImportFiles = vi.fn(
        () => new Promise<void>((resolve) => {
          finishImport = resolve;
        }),
      );
      renderCL({ onImportFiles });
      const { grid } = mockGridLayout();
      const dataTransfer = createFileDataTransfer(
        new File(["# Imported"], "imported.md", { type: "text/markdown" }),
      );

      dispatchDragEvent(grid, "dragenter", dataTransfer, 55);
      dispatchDragEvent(grid, "dragover", dataTransfer, 55);
      dispatchDragEvent(grid, "drop", dataTransfer, 55);

      expect(await screen.findByRole("status")).toHaveTextContent("dropImport.importing");
      await waitFor(() => expect(onImportFiles).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("status")).toBeInTheDocument();

      await act(async () => finishImport?.());
      await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    });

    it("consumes a rejected React Aria import and clears its status with feedback", async () => {
      const error = new Error("persistence failed");
      let rejectImport: ((reason: Error) => void) | undefined;
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const onImportFiles = vi.fn(
        () => new Promise<void>((_resolve, reject) => {
          rejectImport = reject;
        }),
      );
      renderCL({ onImportFiles });
      const { grid } = mockGridLayout();
      const dataTransfer = createFileDataTransfer(
        new File(["# Imported"], "imported.md", { type: "text/markdown" }),
      );

      dispatchDragEvent(grid, "dragenter", dataTransfer, 55);
      dispatchDragEvent(grid, "dragover", dataTransfer, 55);
      dispatchDragEvent(grid, "drop", dataTransfer, 55);

      expect(await screen.findByRole("status")).toBeInTheDocument();
      await waitFor(() => expect(onImportFiles).toHaveBeenCalledTimes(1));
      await act(async () => rejectImport?.(error));
      await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
      expect(consoleError).toHaveBeenCalledWith("Failed to import dropped files:", error);
      expect(mockToastError).toHaveBeenCalledWith("dropImport.importFailed");
      consoleError.mockRestore();
    });

    it("keeps import status visible until overlapping React Aria imports both finish", async () => {
      const resolvers: Array<() => void> = [];
      const onImportFiles = vi.fn(
        () => new Promise<void>((resolve) => resolvers.push(resolve)),
      );
      renderCL({ onImportFiles });
      const { grid } = mockGridLayout();

      for (const [index, name] of ["first.md", "second.md"].entries()) {
        const dataTransfer = createFileDataTransfer(
          new File([`# ${name}`], name, { type: "text/markdown" }),
        );
        dispatchDragEvent(grid, "dragenter", dataTransfer, 55);
        dispatchDragEvent(grid, "dragover", dataTransfer, 55);
        dispatchDragEvent(grid, "drop", dataTransfer, 55);
        await waitFor(() => expect(onImportFiles).toHaveBeenCalledTimes(index + 1));
      }

      expect(onImportFiles).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("status")).toBeInTheDocument();

      await act(async () => resolvers[1]());
      expect(screen.getByRole("status")).toBeInTheDocument();

      await act(async () => resolvers[0]());
      await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    });
  });

  // ---------------------------------------------------------------------------
  describe("word count summary", () => {
    it("shows total word count", () => {
      renderCL();
      expect(screen.getByText("common.totalWords")).toBeInTheDocument();
      expect(screen.getByText("600")).toBeInTheDocument();
    });

    it("shows chapter count", () => {
      renderCL();
      expect(screen.getByText("common.chaptersCount")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  describe("empty state", () => {
    it("shows empty message when no chapters", () => {
      renderCL({ chapters: [] });
      expect(screen.getByText("chapters.noChapters")).toBeInTheDocument();
    });

    it("remounts the real GridList when crossing the empty boundary", () => {
      const props = makeProps({ chapters: [], currentChapterId: null });
      const view = render(<ChapterList {...props} />);

      expect(screen.getByRole("grid")).toBeInTheDocument();
      expect(screen.getByText("chapters.noChapters")).toBeInTheDocument();

      expect(() =>
        view.rerender(
          <ChapterList
            {...props}
            chapters={[defaultChapters[0]]}
            currentChapterId={defaultChapters[0].id}
          />,
        ),
      ).not.toThrow();
      expect(screen.getByRole("grid")).toBeInTheDocument();
      expect(screen.getByRole("row", { name: defaultChapters[0].title })).toBeInTheDocument();

      expect(() =>
        view.rerender(<ChapterList {...props} chapters={[]} currentChapterId={null} />),
      ).not.toThrow();
      expect(screen.getByRole("grid")).toBeInTheDocument();
      expect(screen.getByText("chapters.noChapters")).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  describe("chapter type display", () => {
    it("renders localized chapter type labels", async () => {
      const user = userEvent.setup();
      renderCL();
      await user.click(screen.getByRole("button", { name: "chapters.addChapter" }));
      const selectBtn = screen.getByRole("button", { name: /chapters\.type/ });
      await user.click(selectBtn);
      expect(screen.getByRole("option", { name: "chapters.typeChapter" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "chapters.typePrologue" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "chapters.typeEpilogue" })).toBeInTheDocument();
    });

    it("refreshes cached row labels after a language change", () => {
      const props = makeProps();
      const view = render(<ChapterList {...props} />);
      expect(screen.getAllByRole("button", { name: "chapters.reorder" })).toHaveLength(3);

      i18nState.language = "es";
      view.rerender(<ChapterList {...props} />);

      expect(screen.getAllByRole("button", { name: "Reordenar" })).toHaveLength(3);
    });
  });

  describe("pointer reorder", () => {
    it("reorders chapters via native pointer drag and drop", async () => {
      const onReorder = vi.fn();
      const chapters = [
        buildChapter({ id: "ch-1", title: "First", order: 1 }),
        buildChapter({ id: "ch-2", title: "Second", order: 2 }),
        buildChapter({ id: "ch-3", title: "Third", order: 3 }),
      ];
      renderCL({ chapters, currentChapterId: chapters[0].id, onReorderChapters: onReorder });

      const { grid, rows } = mockGridLayout();
      const dt = createDataTransfer();

      dispatchDragEvent(rows[0], "dragstart", dt, 10);
      expect(dt.types).toContain("chapter");
      await waitFor(() => expect(rows[0]).toHaveAttribute("data-dragging"));
      dispatchDragEvent(grid, "dragenter", dt, 99);
      dispatchDragEvent(grid, "dragover", dt, 99);
      dispatchDragEvent(grid, "drop", dt, 99);

      await waitFor(() => {
        expect(onReorder).toHaveBeenCalledWith(["ch-2", "ch-1", "ch-3"]);
      });
      dispatchDragEvent(rows[0], "dragend", dt, 99);
      await waitFor(() => expect(grid.closest('[aria-hidden="true"]')).toBeNull());
    });

    it("does not invoke onReorderChapters on non-chapter drag types", () => {
      const onReorder = vi.fn();
      const chapters = [
        buildChapter({ id: "ch-1", title: "First", order: 1 }),
        buildChapter({ id: "ch-2", title: "Second", order: 2 }),
      ];
      renderCL({ chapters, currentChapterId: chapters[0].id, onReorderChapters: onReorder });

      const { grid, rows } = mockGridLayout();
      const dt = createDataTransfer();
      dt.setData("other-type", "ch-1");

      dispatchDragEvent(grid, "dragenter", dt, 90);
      dispatchDragEvent(grid, "dragover", dt, 90);
      dispatchDragEvent(grid, "drop", dt, 90);
      dispatchDragEvent(rows[0], "dragend", dt, 90);

      expect(onReorder).not.toHaveBeenCalled();
    });
  });
});
