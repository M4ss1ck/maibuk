import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TOOLBAR_SETTINGS_ROW_GRID,
  TOOLBAR_SETTINGS_ROW_MIN_WIDTH,
  ToolbarSettingsDialog,
} from "@/components/editor/toolbar/ToolbarSettingsDialog";
import { useSettingsStore } from "@/features/settings/store";
import { ALL_GROUP_IDS, type ToolbarConfig } from "@/features/settings/toolbar-config";

const { i18nTestState } = vi.hoisted(() => ({
  i18nTestState: { localizeGroupLabels: false },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) =>
      (i18nTestState.localizeGroupLabels
        ? ({
            "toolbar.groups.history": "History",
            "toolbar.groups.font": "Font",
            "toolbar.groups.basicMarks": "Basic marks",
          })[key]
        : undefined) ?? key,
  }),
}));

function cloneConfig(config: ToolbarConfig): ToolbarConfig {
  return {
    start: config.start.map((entry) => ({ ...entry })),
    end: config.end.map((entry) => ({ ...entry })),
  };
}

const TEST_CONFIG: ToolbarConfig = {
  start: [
    { kind: "group", id: "history", toolbarVisible: true, floatingVisible: false },
    { kind: "divider", id: "divider-1" },
    { kind: "group", id: "basic-marks", toolbarVisible: true, floatingVisible: true },
  ],
  end: [],
};

beforeEach(() => {
  i18nTestState.localizeGroupLabels = false;
  useSettingsStore.setState({ toolbarConfig: cloneConfig(TEST_CONFIG) });
});

// ─── helpers ───────────────────────────────────────────────────────────

function renderDialog() {
  return render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
}

function findStartGrid(): HTMLElement {
  return screen.getByRole("grid", { name: "toolbar.settings.start" });
}

function findEndGrid(): HTMLElement {
  return screen.getByRole("grid", { name: "toolbar.settings.end" });
}

function findRowByName(name: string | RegExp): HTMLElement {
  return screen.getByRole("row", { name });
}

function getDragHandle(row: HTMLElement): HTMLElement {
  return within(row).getByRole("button", { name: "toolbar.settings.dragHandle" });
}

async function tabToControl(
  user: ReturnType<typeof userEvent.setup>,
  row: HTMLElement,
  control: HTMLElement
) {
  row.focus();
  for (let index = 0; index < 10 && document.activeElement !== control; index++) {
    await user.tab();
  }
  expect(control).toHaveFocus();
}

async function arrowToDropTarget(
  user: ReturnType<typeof userEvent.setup>,
  accessibleName: string
) {
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

function mockStartGridLayout() {
  const startGrid = findStartGrid();
  mockRect(startGrid, 0, 140);
  mockRect(findRowByName(/toolbar\.groups\.history/), 0, 40);
  mockRect(findRowByName(/toolbar\.settings\.dividerLabel/), 50, 90);
  mockRect(findRowByName(/toolbar\.groups\.basicMarks/), 100, 140);
  return startGrid;
}

function dispatchDragEvent(
  element: HTMLElement,
  type: "dragstart" | "dragenter" | "dragover" | "drop" | "dragend",
  dataTransfer: DataTransfer,
  clientY: number
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: 10 },
    clientY: { value: clientY },
    dataTransfer: { value: dataTransfer },
    altKey: { value: false },
    ctrlKey: { value: false },
    metaKey: { value: false },
    shiftKey: { value: false },
  });
  fireEvent(element, event);
}

// ─── rendering ────────────────────────────────────────────────────────

it("renders two labelled grids with section headers inside and labels for each entry", () => {
  renderDialog();
  expect(findStartGrid()).toBeInTheDocument();
  expect(findEndGrid()).toBeInTheDocument();
  expect(screen.getByTestId("toolbar-section-header-start")).toHaveTextContent("toolbar.settings.start");
  expect(screen.getByTestId("toolbar-section-header-end")).toHaveTextContent("toolbar.settings.end");
  expect(findRowByName(/toolbar\.groups\.history/)).toBeInTheDocument();
  expect(findRowByName(/toolbar\.groups\.basicMarks/)).toBeInTheDocument();
});

// ─── visibility toggles ───────────────────────────────────────────────

it("toggles group toolbar visibility via keyboard Space and reflects store state", async () => {
  const user = userEvent.setup();
  renderDialog();
  const historyRow = findRowByName(/toolbar\.groups\.history/);
  const sw = within(historyRow).getByRole("switch", { name: "toolbar.settings.toolbarVisible" });
  expect(sw).toHaveAttribute("aria-checked", "true");

  sw.focus();
  await user.keyboard(" ");

  const updated = useSettingsStore.getState().toolbarConfig.start[0];
  expect(updated.kind === "group" && updated.toolbarVisible).toBe(false);
  expect(sw).toHaveAttribute("aria-checked", "false");
});

it("toggles group floating visibility via keyboard Space when eligible", async () => {
  const user = userEvent.setup();
  renderDialog();
  const basicMarksRow = findRowByName(/toolbar\.groups\.basicMarks/);
  const sw = within(basicMarksRow).getByRole("switch", { name: "toolbar.settings.floatingVisible" });
  expect(sw).toHaveAttribute("aria-checked", "true");

  await tabToControl(user, basicMarksRow, sw);
  await user.keyboard(" ");

  const updated = useSettingsStore.getState().toolbarConfig.start[2];
  expect(updated.kind === "group" && updated.floatingVisible).toBe(false);
});

it("disables the floating switch for an ineligible group and labels it accordingly", () => {
  renderDialog();
  const historyRow = findRowByName(/toolbar\.groups\.history/);
  const disabledFloatingSwitch = within(historyRow).getByRole("switch", {
    name: "toolbar.settings.floatingUnavailable",
  });
  expect(disabledFloatingSwitch).toBeDisabled();
});

// ─── contextual add divider controls ───────────────────────────────────

describe("contextual add divider controls", () => {
  it("exposes an Add divider control at eligible middle and end gaps", () => {
    useSettingsStore.setState({
      toolbarConfig: {
        start: [TEST_CONFIG.start[0], TEST_CONFIG.start[2]],
        end: [],
      },
    });
    renderDialog();

    const controls = screen.getAllByTestId(/^toolbar-add-divider-/);
    expect(controls).toHaveLength(2);
    expect(screen.getByTestId("toolbar-add-divider-start-1")).toBeInTheDocument();
    expect(screen.getByTestId("toolbar-add-divider-start-2")).toBeInTheDocument();
  });

  it("inserts a divider at the exact middle index when clicked", () => {
    useSettingsStore.setState({
      toolbarConfig: {
        start: [TEST_CONFIG.start[0], TEST_CONFIG.start[2]],
        end: [],
      },
    });
    renderDialog();

    const control = screen.getByTestId("toolbar-add-divider-start-1");
    const button = within(control).getByRole("button", {
      name: "toolbar.settings.addDivider",
    });
    fireEvent.click(button);

    const start = useSettingsStore.getState().toolbarConfig.start;
    expect(start).toHaveLength(3);
    expect(start[0].id).toBe("history");
    expect(start[1].kind).toBe("divider");
    expect(start[2].id).toBe("basic-marks");
  });

  it("does not render a contextual control before the first entry or in an empty lane", () => {
    useSettingsStore.setState({
      toolbarConfig: {
        start: [TEST_CONFIG.start[0]],
        end: [],
      },
    });
    renderDialog();

    const controls = screen.queryAllByTestId(/^toolbar-add-divider-/);
    expect(controls).toHaveLength(1);
    expect(screen.queryByTestId("toolbar-add-divider-start-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("toolbar-add-divider-end-0")).not.toBeInTheDocument();
  });

  it("does not render controls immediately before or after an existing divider", () => {
    renderDialog();

    const controls = screen.getAllByTestId(/^toolbar-add-divider-/);
    expect(controls).toHaveLength(1);
    expect(screen.queryByTestId("toolbar-add-divider-start-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("toolbar-add-divider-start-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("toolbar-add-divider-start-3")).toBeInTheDocument();
  });

  it("reveals a new eligible gap after removing an existing divider", () => {
    renderDialog();

    expect(screen.getAllByTestId(/^toolbar-add-divider-/)).toHaveLength(1);

    const dividerRow = findRowByName(/toolbar\.settings\.dividerLabel/);
    const removeBtn = within(dividerRow).getByRole("button", { name: "toolbar.settings.remove" });
    fireEvent.click(removeBtn);

    expect(screen.getAllByTestId(/^toolbar-add-divider-/)).toHaveLength(2);
    expect(screen.getByTestId("toolbar-add-divider-start-1")).toBeInTheDocument();
    expect(screen.getByTestId("toolbar-add-divider-start-2")).toBeInTheDocument();
  });

  it("is a keyboard-focusable button with the localized accessible name", () => {
    useSettingsStore.setState({
      toolbarConfig: {
        start: [TEST_CONFIG.start[0]],
        end: [],
      },
    });
    renderDialog();

    const control = within(screen.getByTestId("toolbar-add-divider-start-1")).getByRole(
      "button",
      { name: "toolbar.settings.addDivider" }
    );
    control.focus();
    expect(control).toHaveFocus();
    expect(control).toHaveAttribute("aria-label", "toolbar.settings.addDivider");
  });

  it("appears on row hover or focus, spans most of the row, and hides during drag", () => {
    renderDialog();

    const control = screen.getByTestId("toolbar-add-divider-start-3");
    expect(control).toHaveClass(
      "absolute",
      "w-[90%]",
      "pointer-events-none",
      "opacity-0",
      "group-hover:pointer-events-auto",
      "group-hover:opacity-100",
      "focus-within:pointer-events-auto",
      "focus-within:opacity-100"
    );
    expect(control.querySelector("svg")).toBeInTheDocument();
  });
});

// ─── direct move up/down buttons ──────────────────────────────────────

it("moves entries up and down via keyboard Enter and disables move buttons at boundaries", async () => {
  const user = userEvent.setup();
  renderDialog();
  const historyRow = findRowByName(/toolbar\.groups\.history/);
  const moveDownBtn = within(historyRow).getByRole("button", { name: "toolbar.settings.moveDown" });

  expect(within(historyRow).getByRole("button", { name: "toolbar.settings.moveUp" })).toBeDisabled();

  moveDownBtn.focus();
  await user.keyboard("{Enter}");

  const reordered = useSettingsStore.getState().toolbarConfig.start;
  expect(reordered[0].kind).toBe("divider");
  expect(reordered[1].kind === "group" && reordered[1].id).toBe("history");
});

// ─── keyboard operation of every control ──────────────────────────────

describe("keyboard operation of every control", () => {
  it("toggles toolbar switch via Space", async () => {
    const user = userEvent.setup();
    renderDialog();
    const historyRow = findRowByName(/toolbar\.groups\.history/);
    const sw = within(historyRow).getByRole("switch", { name: "toolbar.settings.toolbarVisible" });
    sw.focus();
    await user.keyboard(" ");
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  it("toggles floating switch via Space", async () => {
    const user = userEvent.setup();
    renderDialog();
    const basicMarksRow = findRowByName(/toolbar\.groups\.basicMarks/);
    const sw = within(basicMarksRow).getByRole("switch", { name: "toolbar.settings.floatingVisible" });
    expect(sw).toHaveAttribute("aria-checked", "true");

    await tabToControl(user, basicMarksRow, sw);
    await user.keyboard(" ");
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  it("moves the divider down via keyboard Enter", async () => {
    const user = userEvent.setup();
    renderDialog();
    const dividerRow = findRowByName(/toolbar\.settings\.dividerLabel/);
    const moveDown = within(dividerRow).getByRole("button", { name: "toolbar.settings.moveDown" });
    expect(moveDown).not.toBeDisabled();

    await tabToControl(user, dividerRow, moveDown);
    await user.keyboard("{Enter}");

    const start = useSettingsStore.getState().toolbarConfig.start;
    expect(start[1].kind === "group" && start[1].id).toBe("basic-marks");
    expect(start[2].kind).toBe("divider");
  });

  it("removes divider via keyboard Enter", async () => {
    const user = userEvent.setup();
    renderDialog();
    const dividerRow = findRowByName(/toolbar\.settings\.dividerLabel/);
    const removeBtn = within(dividerRow).getByRole("button", { name: "toolbar.settings.remove" });

    await tabToControl(user, dividerRow, removeBtn);
    await user.keyboard("{Enter}");

    const start = useSettingsStore.getState().toolbarConfig.start;
    expect(start).toHaveLength(2);
    expect(start.every((e) => e.kind !== "divider")).toBe(true);
  });

  it("adds divider via keyboard Enter", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({
      toolbarConfig: {
        start: [TEST_CONFIG.start[0], TEST_CONFIG.start[2]],
        end: [],
      },
    });
    renderDialog();

    const addBtn = within(screen.getByTestId("toolbar-add-divider-start-1")).getByRole(
      "button",
      { name: "toolbar.settings.addDivider" }
    );

    addBtn.focus();
    expect(addBtn).toHaveFocus();
    await user.keyboard("{Enter}");

    const start = useSettingsStore.getState().toolbarConfig.start;
    expect(start).toHaveLength(3);
    expect(start[1].kind).toBe("divider");
  });

  it("resets toolbar config after keyboard Enter on confirm", async () => {
    const user = userEvent.setup();
    renderDialog();

    const resetBtn = screen.getByRole("button", { name: "toolbar.settings.reset", hidden: true });
    resetBtn.focus();
    await user.keyboard("{Enter}");

    expect(useSettingsStore.getState().toolbarConfig.start).toHaveLength(TEST_CONFIG.start.length);

    const confirmBtn = screen.getByRole("button", { name: "toolbar.settings.resetConfirm", hidden: true });
    confirmBtn.focus();
    await user.keyboard("{Enter}");

    const restored = useSettingsStore.getState().toolbarConfig;
    const restoredGroupIds = restored.start
      .filter((entry) => entry.kind === "group")
      .map((entry) => entry.id);
    expect(restoredGroupIds).toEqual([...ALL_GROUP_IDS]);
  });

  it("closes dialog via keyboard Enter on Close", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ToolbarSettingsDialog isOpen onClose={onClose} />);

    const closeBtn = screen.getByRole("button", { name: "toolbar.settings.close", hidden: true });
    closeBtn.focus();
    await user.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides add-divider controls while a keyboard drag is active", async () => {
    const user = userEvent.setup();
    renderDialog();

    const historyRow = findRowByName(/toolbar\.groups\.history/);
    const dragHandle = getDragHandle(historyRow);
    dragHandle.focus();
    await user.keyboard("{Enter}");

    // During drag, isDragging=true hides the add-divider control
    const control = screen.getByTestId("toolbar-add-divider-start-3");
    expect(control).toHaveClass("pointer-events-none", "opacity-0");

    // Cancel the drag
    await user.keyboard("{Escape}");
    expect(useSettingsStore.getState().toolbarConfig.start[0].id).toBe("history");
  });
});

// ─── keyboard navigation: arrows, home, end ───────────────────────────

describe("keyboard navigation (React Aria GridList)", () => {
  it("ArrowDown moves focus to next row without reordering entries", async () => {
    const user = userEvent.setup();
    renderDialog();
    const historyRow = findRowByName(/toolbar\.groups\.history/);
    const dividerRow = findRowByName(/toolbar\.settings\.dividerLabel/);

    historyRow.focus();
    expect(historyRow).toHaveFocus();

    await user.keyboard("{ArrowDown}");

    expect(dividerRow).toHaveFocus();
    expect(useSettingsStore.getState().toolbarConfig.start[0].id).toBe("history");
  });

  it("ArrowUp moves focus to previous row without reordering entries", async () => {
    const user = userEvent.setup();
    renderDialog();
    const dividerRow = findRowByName(/toolbar\.settings\.dividerLabel/);
    const historyRow = findRowByName(/toolbar\.groups\.history/);

    dividerRow.focus();
    expect(dividerRow).toHaveFocus();

    await user.keyboard("{ArrowUp}");

    expect(historyRow).toHaveFocus();
    expect(useSettingsStore.getState().toolbarConfig.start[0].id).toBe("history");
  });

  it("Home moves focus to first row in the section", async () => {
    const user = userEvent.setup();
    renderDialog();
    const historyRow = findRowByName(/toolbar\.groups\.history/);
    const basicMarksRow = findRowByName(/toolbar\.groups\.basicMarks/);

    basicMarksRow.focus();
    expect(basicMarksRow).toHaveFocus();

    await user.keyboard("{Home}");

    expect(historyRow).toHaveFocus();
  });

  it("End moves focus to last row in the section", async () => {
    const user = userEvent.setup();
    renderDialog();
    const historyRow = findRowByName(/toolbar\.groups\.history/);
    const basicMarksRow = findRowByName(/toolbar\.groups\.basicMarks/);

    historyRow.focus();
    expect(historyRow).toHaveFocus();

    await user.keyboard("{End}");

    expect(basicMarksRow).toHaveFocus();
  });

  it("typeahead finds a matching localized group with a short prefix", async () => {
    const user = userEvent.setup();
    i18nTestState.localizeGroupLabels = true;
    useSettingsStore.setState({
      toolbarConfig: {
        start: [
          { kind: "group", id: "history", toolbarVisible: true, floatingVisible: false },
          { kind: "group", id: "font", toolbarVisible: true, floatingVisible: false },
          { kind: "group", id: "basic-marks", toolbarVisible: true, floatingVisible: true },
        ],
        end: [],
      },
    });
    renderDialog();

    const historyRow = findRowByName(/History/);
    historyRow.focus();

    await user.keyboard("bas");

    expect(findRowByName(/Basic marks/)).toHaveFocus();
  });
});

// ─── keyboard drag-and-drop ───────────────────────────────────────────

describe("keyboard drag-and-drop (React Aria)", () => {
  it("reorders downward and keeps focus on the moved row after drop", async () => {
    const user = userEvent.setup();
    renderDialog();
    const historyRow = findRowByName(/toolbar\.groups\.history/);
    const dragHandle = getDragHandle(historyRow);

    dragHandle.focus();
    await user.keyboard("{Enter}");
    await arrowToDropTarget(user, "Insert after toolbar.groups.basicMarks");
    await user.keyboard("{Enter}");

    const state = useSettingsStore.getState().toolbarConfig;
    expect(state.start[2].kind === "group" && state.start[2].id).toBe("history");

    // After drop, focus is on the moved row
    const movedRow = findRowByName(/toolbar\.groups\.history/);
    expect(document.activeElement).toBe(movedRow);
  });

  it("Escape cancels drag without changing order", async () => {
    const user = userEvent.setup();
    renderDialog();
    const historyRow = findRowByName(/toolbar\.groups\.history/);
    const dragHandle = getDragHandle(historyRow);

    dragHandle.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Escape}");

    expect(useSettingsStore.getState().toolbarConfig.start[0].id).toBe("history");
  });

  it("moves an entry across sections with cross-section keyboard DnD", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({
      toolbarConfig: {
        start: TEST_CONFIG.start,
        end: [
          { kind: "group", id: "find", toolbarVisible: true, floatingVisible: false },
        ],
      },
    });
    renderDialog();
    const historyRow = findRowByName(/toolbar\.groups\.history/);
    const dragHandle = getDragHandle(historyRow);

    dragHandle.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Tab}");
    await user.keyboard("{Enter}");

    const state = useSettingsStore.getState().toolbarConfig;
    expect(state.start).toHaveLength(TEST_CONFIG.start.length - 1);
    expect(state.end).toHaveLength(2);
    expect(state.end.some((e) => e.kind === "group" && e.id === "history")).toBe(true);
  });

  it("drops into an empty End section via cross-section keyboard DnD", async () => {
    const user = userEvent.setup();
    renderDialog();
    const historyRow = findRowByName(/toolbar\.groups\.history/);
    const dragHandle = getDragHandle(historyRow);

    dragHandle.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Tab}");
    await user.keyboard("{Enter}");

    const state = useSettingsStore.getState().toolbarConfig;
    expect(state.start).toHaveLength(TEST_CONFIG.start.length - 1);
    expect(state.end).toHaveLength(1);
    expect(state.end[0].kind === "group" && state.end[0].id).toBe("history");
  });

  it("announces the new position after a keyboard DnD move", async () => {
    const user = userEvent.setup();
    renderDialog();
    const historyRow = findRowByName(/toolbar\.groups\.history/);
    const dragHandle = getDragHandle(historyRow);

    dragHandle.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(screen.getByRole("status")).toHaveTextContent("toolbar.settings.moved");
  });

  it("reaches the localized drag handle by keyboard", async () => {
    const user = userEvent.setup();
    renderDialog();
    const historyRow = findRowByName(/toolbar\.groups\.history/);
    const dragHandle = within(historyRow).getByRole("button", { name: "toolbar.settings.dragHandle" });

    await tabToControl(user, historyRow, dragHandle);
  });
});

// ─── pointer reorder ──────────────────────────────────────────────────

describe("pointer drag-and-drop (React Aria)", () => {
  it("reorders within a section by dragging via native drag events", async () => {
    renderDialog();
    const historyRow = findRowByName(/toolbar\.groups\.history/);
    const startGrid = mockStartGridLayout();
    const dataTransfer = createDataTransfer();

    dispatchDragEvent(historyRow, "dragstart", dataTransfer, 10);
    expect(dataTransfer.types).toContain("toolbar-entry");
    await waitFor(() => expect(historyRow).toHaveAttribute("data-dragging"));
    dispatchDragEvent(startGrid, "dragenter", dataTransfer, 139);
    expect(dataTransfer.dropEffect).toBe("move");
    dispatchDragEvent(startGrid, "dragover", dataTransfer, 139);
    dispatchDragEvent(startGrid, "drop", dataTransfer, 139);

    await waitFor(() => {
      expect(useSettingsStore.getState().toolbarConfig.start.map((entry) => entry.id)).toEqual([
        "divider-1",
        "basic-marks",
        "history",
      ]);
    });

    dispatchDragEvent(historyRow, "dragend", dataTransfer, 139);
  });

  it("drag renders drop indicator elements during drag", async () => {
    renderDialog();
    const historyRow = findRowByName(/toolbar\.groups\.history/);
    const startGrid = mockStartGridLayout();
    const dataTransfer = createDataTransfer();

    dispatchDragEvent(historyRow, "dragstart", dataTransfer, 10);
    expect(dataTransfer.types).toContain("toolbar-entry");
    await waitFor(() => expect(historyRow).toHaveAttribute("data-dragging"));
    dispatchDragEvent(startGrid, "dragenter", dataTransfer, 139);
    expect(dataTransfer.dropEffect).toBe("move");
    dispatchDragEvent(startGrid, "dragover", dataTransfer, 139);

    await waitFor(() => {
      expect(document.querySelector("[data-drop-target]")).not.toBeNull();
    });

    dispatchDragEvent(historyRow, "dragend", dataTransfer, 139);
  });
});

// ─── reset & close ────────────────────────────────────────────────────

it("resets to defaults only after the inline confirm step", () => {
  renderDialog();
  const resetButton = screen.getByRole("button", {
    name: "toolbar.settings.reset",
    hidden: true,
  });

  fireEvent.click(resetButton);
  expect(useSettingsStore.getState().toolbarConfig.start).toHaveLength(TEST_CONFIG.start.length);

  const confirmButton = screen.getByRole("button", {
    name: "toolbar.settings.resetConfirm",
    hidden: true,
  });
  fireEvent.click(confirmButton);

  const restored = useSettingsStore.getState().toolbarConfig;
  const restoredGroupIds = restored.start
    .filter((entry) => entry.kind === "group")
    .map((entry) => entry.id);
  expect(restoredGroupIds).toEqual([...ALL_GROUP_IDS]);
  expect(restored.end).toEqual([]);
});

it("calls onClose when the Close button is clicked", () => {
  const onClose = vi.fn();
  render(<ToolbarSettingsDialog isOpen onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "toolbar.settings.close", hidden: true }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

// ─── column headers and tooltips ──────────────────────────────────────

describe("column headers and tooltips", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => vi.runOnlyPendingTimers());
    vi.useRealTimers();
  });

  it("renders five localized column headers once", () => {
    renderDialog();
    const expectedHeaders = [
      "toolbar.settings.itemColumn",
      "toolbar.settings.toolbarColumn",
      "toolbar.settings.selectionMenuColumn",
      "toolbar.settings.orderColumn",
      "toolbar.settings.actionsColumn",
    ];
    for (const header of expectedHeaders) {
      expect(screen.getAllByText(header)).toHaveLength(1);
    }
  });

  it("shares the same grid template and minimum width between header, grids, and rows inside a horizontal scroll viewport", () => {
    renderDialog();
    const startGrid = findStartGrid();
    const viewport = startGrid.closest(".overflow-x-auto") as HTMLElement;
    expect(viewport).toBeInTheDocument();

    const header = viewport.firstElementChild as HTMLElement;
    expect(header).toHaveClass(
      TOOLBAR_SETTINGS_ROW_GRID,
      TOOLBAR_SETTINGS_ROW_MIN_WIDTH
    );

    const historyRow = findRowByName(/toolbar\.groups\.history/);
    expect(historyRow).toHaveClass(
      TOOLBAR_SETTINGS_ROW_GRID,
      TOOLBAR_SETTINGS_ROW_MIN_WIDTH
    );

    const dividerRow = findRowByName(/toolbar\.settings\.dividerLabel/);
    expect(dividerRow).toHaveClass(
      TOOLBAR_SETTINGS_ROW_GRID,
      TOOLBAR_SETTINGS_ROW_MIN_WIDTH
    );
  });

  it("places group controls and divider placeholders under the intended columns", () => {
    renderDialog();
    const historyRow = findRowByName(/toolbar\.groups\.history/);

    expect(
      within(historyRow).getByRole("button", { name: "toolbar.settings.dragHandle" })
    ).toBeInTheDocument();
    expect(
      within(historyRow).getByRole("switch", { name: "toolbar.settings.toolbarVisible" })
    ).toBeInTheDocument();
    expect(
      within(historyRow).getByRole("switch", { name: "toolbar.settings.floatingUnavailable" })
    ).toBeInTheDocument();
    expect(within(historyRow).getAllByRole("button", { name: "toolbar.settings.moveUp" })).toHaveLength(1);
    expect(within(historyRow).getAllByRole("button", { name: "toolbar.settings.moveDown" })).toHaveLength(1);

    const dividerRow = findRowByName(/toolbar\.settings\.dividerLabel/);

    expect(
      within(dividerRow).getByRole("button", { name: "toolbar.settings.dragHandle" })
    ).toBeInTheDocument();
    expect(within(dividerRow).getAllByRole("button", { name: "toolbar.settings.moveUp" })).toHaveLength(1);
    expect(within(dividerRow).getAllByRole("button", { name: "toolbar.settings.moveDown" })).toHaveLength(1);
    expect(
      within(dividerRow).getByRole("button", { name: "toolbar.settings.remove" })
    ).toBeInTheDocument();

    const hiddenCells = within(dividerRow).getAllByRole("generic", { hidden: true }).filter(
      (el) => el.getAttribute("aria-hidden") === "true"
    );
    expect(hiddenCells.length).toBeGreaterThanOrEqual(1);
  });

  it("retains localized accessible names for icon-only controls", () => {
    renderDialog();
    expect(screen.getAllByLabelText("toolbar.settings.dragHandle").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByRole("button", { name: "toolbar.settings.moveUp" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "toolbar.settings.moveDown" })).toHaveLength(3);
    expect(
      screen.queryAllByRole("button", { name: "toolbar.settings.transferToEnd" })
    ).toHaveLength(0);
    expect(
      screen.queryAllByRole("button", { name: "toolbar.settings.transferToStart" })
    ).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "toolbar.settings.remove" })
    ).toBeInTheDocument();
  });

  it("aligns action column headers with their centered content", () => {
    renderDialog();
    const centeredHeaders = [
      "toolbar.settings.toolbarColumn",
      "toolbar.settings.selectionMenuColumn",
      "toolbar.settings.orderColumn",
      "toolbar.settings.actionsColumn",
    ];
    for (const header of centeredHeaders) {
      expect(screen.getAllByText(header)[0]).toHaveClass("text-center");
    }
    expect(screen.getAllByText("toolbar.settings.itemColumn")[0]).not.toHaveClass("text-center");
  });

  it("exposes header help tooltips when a column header is hovered", () => {
    renderDialog();
    const itemHeader = screen.getByText("toolbar.settings.itemColumn");
    fireEvent.mouseEnter(itemHeader);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "toolbar.settings.itemColumnHelp"
    );
  });

  it("prevents text selection on draggable rows", () => {
    renderDialog();
    const historyRow = findRowByName(/toolbar\.groups\.history/);
    const dividerRow = findRowByName(/toolbar\.settings\.dividerLabel/);
    expect(historyRow).toHaveClass("select-none");
    expect(dividerRow).toHaveClass("select-none");
  });

  it("exposes control tooltips when an icon-only button is hovered", () => {
    renderDialog();
    const moveUp = screen.getAllByRole("button", {
      name: "toolbar.settings.moveUp",
    })[0];
    fireEvent.mouseEnter(moveUp);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "toolbar.settings.moveUp"
    );
  });
});
