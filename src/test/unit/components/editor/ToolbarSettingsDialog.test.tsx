import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TOOLBAR_SETTINGS_ROW_GRID,
  TOOLBAR_SETTINGS_ROW_MIN_WIDTH,
  ToolbarSettingsDialog,
} from "@/components/editor/toolbar/ToolbarSettingsDialog";
import { useSettingsStore } from "@/features/settings/store";
import { ALL_GROUP_IDS, type ToolbarConfig } from "@/features/settings/toolbar-config";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

function cloneConfig(config: ToolbarConfig): ToolbarConfig {
  return {
    start: config.start.map((entry) => ({ ...entry })),
    end: config.end.map((entry) => ({ ...entry })),
  };
}

const TEST_CONFIG: ToolbarConfig = {
  start: [
    {
      kind: "group",
      id: "history",
      toolbarVisible: true,
      floatingVisible: false,
    },
    { kind: "divider", id: "divider-1" },
    {
      kind: "group",
      id: "basic-marks",
      toolbarVisible: true,
      floatingVisible: true,
    },
  ],
  end: [],
};

beforeEach(() => {
  useSettingsStore.setState({ toolbarConfig: cloneConfig(TEST_CONFIG) });
});

it("renders one listbox with section headers inside and labels for each entry", () => {
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  expect(screen.getByRole("listbox", { name: "toolbar.settings.title" })).toBeInTheDocument();
  expect(screen.getByTestId("toolbar-section-header-start")).toHaveTextContent("toolbar.settings.start");
  expect(screen.getByTestId("toolbar-section-header-end")).toHaveTextContent("toolbar.settings.end");
  expect(screen.getByText("toolbar.groups.history")).toBeInTheDocument();
  expect(screen.getByText("toolbar.groups.basicMarks")).toBeInTheDocument();
});

it("toggles group toolbar visibility via the store and reflects state", () => {
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  const toolbarSwitches = screen.getAllByRole("switch", {
    name: "toolbar.settings.toolbarVisible",
  });
  expect(toolbarSwitches[0]).toHaveAttribute("aria-checked", "true");

  fireEvent.click(toolbarSwitches[0]);

  const updated = useSettingsStore.getState().toolbarConfig.start[0];
  expect(updated.kind === "group" && updated.toolbarVisible).toBe(false);
  expect(toolbarSwitches[0]).toHaveAttribute("aria-checked", "false");
});

it("toggles group floating visibility via the store when eligible", () => {
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  const floatingSwitches = screen.getAllByRole("switch", {
    name: "toolbar.settings.floatingVisible",
  });
  // basic-marks is the only floating-eligible group in the test config.
  expect(floatingSwitches).toHaveLength(1);
  expect(floatingSwitches[0]).toHaveAttribute("aria-checked", "true");

  fireEvent.click(floatingSwitches[0]);

  const updated = useSettingsStore.getState().toolbarConfig.start[2];
  expect(updated.kind === "group" && updated.floatingVisible).toBe(false);
});

it("disables the floating switch for an ineligible group and labels it accordingly", () => {
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  const disabledFloatingSwitch = screen.getByRole("switch", {
    name: "toolbar.settings.floatingUnavailable",
  });
  expect(disabledFloatingSwitch).toBeDisabled();
});

describe("contextual add divider controls", () => {
  it("exposes an Add divider control at eligible middle and end gaps", () => {
    useSettingsStore.setState({
      toolbarConfig: {
        start: [TEST_CONFIG.start[0], TEST_CONFIG.start[2]],
        end: [],
      },
    });
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);

    const controls = screen.getAllByRole("button", {
      name: "toolbar.settings.addDivider",
    });
    expect(controls).toHaveLength(2);
    expect(
      screen.getByTestId("toolbar-add-divider-start-1")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("toolbar-add-divider-start-2")
    ).toBeInTheDocument();
  });

  it("inserts a divider at the exact middle index when clicked", () => {
    useSettingsStore.setState({
      toolbarConfig: {
        start: [TEST_CONFIG.start[0], TEST_CONFIG.start[2]],
        end: [],
      },
    });
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);

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

  it("does not render a control before the first entry or in an empty lane", () => {
    useSettingsStore.setState({
      toolbarConfig: {
        start: [TEST_CONFIG.start[0]],
        end: [],
      },
    });
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);

    const controls = screen.queryAllByRole("button", {
      name: "toolbar.settings.addDivider",
    });
    expect(controls).toHaveLength(1);
    expect(
      screen.queryByTestId("toolbar-add-divider-start-0")
    ).not.toBeInTheDocument();

    const listbox = screen.getByRole("listbox", {
      name: "toolbar.settings.title",
    });
    const endHeader = within(listbox).getByTestId("toolbar-section-header-end");
    expect(
      within(endHeader).queryByRole("button", {
        name: "toolbar.settings.addDivider",
      })
    ).not.toBeInTheDocument();
  });

  it("does not render controls immediately before or after an existing divider", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);

    const controls = screen.getAllByRole("button", {
      name: "toolbar.settings.addDivider",
    });
    // TEST_CONFIG.start = [history, divider, basic-marks]; only the trailing gap is eligible.
    expect(controls).toHaveLength(1);
    expect(
      screen.queryByTestId("toolbar-add-divider-start-1")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("toolbar-add-divider-start-2")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("toolbar-add-divider-start-3")
    ).toBeInTheDocument();
  });

  it("reveals a new eligible gap after removing an existing divider", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);

    expect(
      screen.getAllByRole("button", { name: "toolbar.settings.addDivider" })
    ).toHaveLength(1);

    const removeButtons = screen.getAllByRole("button", {
      name: "toolbar.settings.remove",
    });
    fireEvent.click(removeButtons[0]);

    expect(
      screen.getAllByRole("button", { name: "toolbar.settings.addDivider" })
    ).toHaveLength(2);
    expect(
      screen.getByTestId("toolbar-add-divider-start-1")
    ).toBeInTheDocument();
  });

  it("is a keyboard-focusable button with the localized accessible name", () => {
    useSettingsStore.setState({
      toolbarConfig: {
        start: [TEST_CONFIG.start[0]],
        end: [],
      },
    });
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);

    const control = screen.getByRole("button", {
      name: "toolbar.settings.addDivider",
    });
    control.focus();
    expect(control).toHaveFocus();
    expect(control).toHaveAttribute("aria-label", "toolbar.settings.addDivider");
  });

  it("keeps layout-stable, pointer-safe classes and does not replace DnD indicators", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);

    const control = screen.getByTestId("toolbar-add-divider-start-3");
    expect(control).toHaveClass(
      "absolute",
      "pointer-events-none",
      "group-hover:pointer-events-auto",
      "focus-within:pointer-events-auto"
    );
    expect(control.querySelector("svg")).toBeInTheDocument();

    const history = screen.getByRole("option", { name: /toolbar\.groups\.history/ });
    const basicMarks = screen.getByRole("option", { name: /toolbar\.groups\.basicMarks/ });
    vi.spyOn(basicMarks, "getBoundingClientRect").mockReturnValue({
      top: 100,
      height: 40,
    } as DOMRect);
    const dataTransfer = {
      effectAllowed: "none",
      dropEffect: "none",
      setData: vi.fn(),
    };

    fireEvent.dragStart(within(history).getByLabelText("toolbar.settings.dragHandle"), { dataTransfer });
    fireEvent.dragOver(basicMarks, { clientY: 139, dataTransfer });

    expect(
      screen.getByTestId("toolbar-drop-indicator-after-basic-marks")
    ).toBeInTheDocument();
    expect(control).toBeInTheDocument();
  });
});

it("moves entries up and down and disables move buttons at boundaries", () => {
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  const moveUpButtons = screen.getAllByRole("button", {
    name: "toolbar.settings.moveUp",
  });
  const moveDownButtons = screen.getAllByRole("button", {
    name: "toolbar.settings.moveDown",
  });

  // First entry (history) cannot move up; last entry (basic-marks) cannot move down.
  expect(moveUpButtons[0]).toBeDisabled();
  expect(moveDownButtons[moveDownButtons.length - 1]).toBeDisabled();

  fireEvent.click(moveDownButtons[0]);

  const reordered = useSettingsStore.getState().toolbarConfig.start;
  expect(reordered[0].kind).toBe("divider");
  expect(reordered[1].kind === "group" && reordered[1].id).toBe("history");
});

it("reorders entries within a section by dragging the dedicated handle", () => {
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  const history = screen.getByRole("option", { name: /toolbar\.groups\.history/ });
  const basicMarks = screen.getByRole("option", { name: /toolbar\.groups\.basicMarks/ });
  vi.spyOn(basicMarks, "getBoundingClientRect").mockReturnValue({
    top: 100,
    height: 40,
  } as DOMRect);
  const dataTransfer = {
    effectAllowed: "none",
    dropEffect: "none",
    setData: vi.fn(),
  };

  fireEvent.dragStart(
    within(history).getByLabelText("toolbar.settings.dragHandle"),
    { dataTransfer }
  );
  fireEvent.dragOver(basicMarks, { clientY: 139, dataTransfer });
  const indicator = screen.getByTestId("toolbar-drop-indicator-after-basic-marks");
  expect(indicator).toHaveClass("pointer-events-none", "absolute", "bottom-0");
  fireEvent.drop(basicMarks, { clientY: 139, dataTransfer });

  expect(useSettingsStore.getState().toolbarConfig.start.map((entry) => entry.id)).toEqual([
    "divider-1",
    "basic-marks",
    "history",
  ]);
});

it("moves an entry across sections by dropping after the destination section header", () => {
  useSettingsStore.setState({
    toolbarConfig: {
      start: TEST_CONFIG.start,
      end: [
        {
          kind: "group",
          id: "find",
          toolbarVisible: true,
          floatingVisible: false,
        },
      ],
    },
  });
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  const history = screen.getByRole("option", { name: /toolbar\.groups\.history/ });
  const endHeader = screen.getByTestId("toolbar-section-header-end");
  const dataTransfer = {
    effectAllowed: "none",
    dropEffect: "none",
    setData: vi.fn(),
  };

  vi.spyOn(endHeader, "getBoundingClientRect").mockReturnValue({
    top: 200,
    height: 32,
  } as DOMRect);

  fireEvent.dragStart(
    within(history).getByLabelText("toolbar.settings.dragHandle"),
    { dataTransfer }
  );
  fireEvent.dragOver(endHeader, { clientY: 223, dataTransfer });
  fireEvent.drop(endHeader, { clientY: 223, dataTransfer });

  const state = useSettingsStore.getState().toolbarConfig;
  expect(state.start).toHaveLength(TEST_CONFIG.start.length - 1);
  expect(state.end).toHaveLength(2);
  expect(state.end[state.end.length - 1].kind === "group" && state.end[state.end.length - 1].id).toBe("history");
});

it("reorders with ArrowDown and keeps focus on the moved option", () => {
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  const history = screen.getByRole("option", { name: /toolbar\.groups\.history/ });

  history.focus();
  fireEvent.keyDown(history, { key: "ArrowDown" });

  const movedHistory = screen.getByRole("option", { name: /toolbar\.groups\.history/ });
  expect(movedHistory).toHaveFocus();
  expect(movedHistory).toHaveAttribute("aria-posinset", "2");
  expect(useSettingsStore.getState().toolbarConfig.start[1]).toMatchObject({
    kind: "group",
    id: "history",
  });
});

it("announces the new position after a move", () => {
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  const history = screen.getByRole("option", { name: /toolbar\.groups\.history/ });

  history.focus();
  fireEvent.keyDown(history, { key: "ArrowDown" });

  expect(screen.getByRole("status")).toHaveTextContent("toolbar.settings.moved");
});

it("keeps one tabbable option in the listbox", () => {
  useSettingsStore.setState({
    toolbarConfig: {
      start: [TEST_CONFIG.start[0]],
      end: [TEST_CONFIG.start[2]],
    },
  });
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);

  const listbox = screen.getByRole("listbox");
  expect(
    within(listbox)
      .getAllByRole("option")
      .filter((option) => option.tabIndex === 0)
  ).toHaveLength(1);
});

it("falls back to another tabbable option when the active entry is removed", () => {
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  const divider = screen.getByRole("option", { name: "toolbar.settings.dividerLabel" });
  divider.focus();

  fireEvent.click(within(divider).getByRole("button", { name: "toolbar.settings.remove" }));

  const listbox = screen.getByRole("listbox");
  expect(
    within(listbox)
      .getAllByRole("option")
      .filter((option) => option.tabIndex === 0)
  ).toHaveLength(1);
});

it("resets to defaults only after the inline confirm step", () => {
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  const resetButton = screen.getByRole("button", {
    name: "toolbar.settings.reset",
  });

  fireEvent.click(resetButton);
  // First click only reveals the confirm affordance; store is unchanged.
  expect(useSettingsStore.getState().toolbarConfig.start).toHaveLength(TEST_CONFIG.start.length);

  const confirmButton = screen.getByRole("button", {
    name: "toolbar.settings.resetConfirm",
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
  fireEvent.click(screen.getByRole("button", { name: "toolbar.settings.close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

describe("auto-scroll during drag", () => {
  let frameQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
  let nextFrameId = 1;

  beforeEach(() => {
    frameQueue = [];
    nextFrameId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      const id = nextFrameId++;
      frameQueue.push({ id, cb });
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frameQueue = frameQueue.filter((frame) => frame.id !== id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function flushFrames(count = 1) {
    for (let i = 0; i < count; i++) {
      if (frameQueue.length === 0) break;
      const frames = [...frameQueue];
      frameQueue = [];
      frames.forEach((frame) => {
        frame.cb(0);
      });
    }
  }

  function setupLaneGeometry(lane: HTMLElement, scrollTop = 100) {
    Object.defineProperty(lane, "scrollTop", {
      value: scrollTop,
      writable: true,
      configurable: true,
    });
    lane.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 500,
        left: 0,
        right: 0,
        width: 0,
        height: 500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  }

  function makeDataTransfer() {
    return {
      effectAllowed: "none",
      dropEffect: "none",
      setData: vi.fn(),
    };
  }

  function dragOverWithClientY(
    target: HTMLElement,
    clientY: number,
    dataTransfer: ReturnType<typeof makeDataTransfer>
  ) {
    const event = new MouseEvent("dragover", { bubbles: true, clientY });
    Object.defineProperty(event, "dataTransfer", {
      value: dataTransfer,
      configurable: true,
    });
    target.dispatchEvent(event);
  }

  function dropWithClientY(
    target: HTMLElement,
    clientY: number,
    dataTransfer: ReturnType<typeof makeDataTransfer>
  ) {
    const event = new MouseEvent("drop", { bubbles: true, clientY });
    Object.defineProperty(event, "dataTransfer", {
      value: dataTransfer,
      configurable: true,
    });
    target.dispatchEvent(event);
  }

  it("renders bounded overflow-y-auto listbox", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const listbox = screen.getByRole("listbox", {
      name: "toolbar.settings.title",
    });
    expect(listbox).toHaveClass("min-h-8", "max-h-[55vh]", "overflow-y-auto");
  });

  it("scrolls downward when dragging near the bottom of the list", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const listbox = screen.getByRole("listbox", {
      name: "toolbar.settings.title",
    });
    setupLaneGeometry(listbox, 100);
    const history = screen.getByRole("option", {
      name: /toolbar\.groups\.history/,
    });
    const dataTransfer = makeDataTransfer();

    fireEvent.dragStart(
      within(history).getByLabelText("toolbar.settings.dragHandle"),
      { dataTransfer }
    );
    dragOverWithClientY(listbox, 495, dataTransfer);
    flushFrames(1);

    expect(listbox.scrollTop).toBeGreaterThan(100);
  });

  it("scrolls upward when dragging near the top of the list", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const listbox = screen.getByRole("listbox", {
      name: "toolbar.settings.title",
    });
    setupLaneGeometry(listbox, 100);
    const history = screen.getByRole("option", {
      name: /toolbar\.groups\.history/,
    });
    const dataTransfer = makeDataTransfer();

    fireEvent.dragStart(
      within(history).getByLabelText("toolbar.settings.dragHandle"),
      { dataTransfer }
    );
    dragOverWithClientY(listbox, 8, dataTransfer);
    flushFrames(1);

    expect(listbox.scrollTop).toBeLessThan(100);
  });

  it("stops scrolling on row drop", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const listbox = screen.getByRole("listbox", {
      name: "toolbar.settings.title",
    });
    setupLaneGeometry(listbox, 100);
    const history = screen.getByRole("option", {
      name: /toolbar\.groups\.history/,
    });
    const basicMarks = screen.getByRole("option", {
      name: /toolbar\.groups\.basicMarks/,
    });
    vi.spyOn(basicMarks, "getBoundingClientRect").mockReturnValue({
      top: 100,
      height: 40,
    } as DOMRect);
    const dataTransfer = makeDataTransfer();

    fireEvent.dragStart(
      within(history).getByLabelText("toolbar.settings.dragHandle"),
      { dataTransfer }
    );
    dragOverWithClientY(basicMarks, 495, dataTransfer);
    flushFrames(1);
    const scrolledTop = listbox.scrollTop;
    expect(scrolledTop).toBeGreaterThan(100);

    dropWithClientY(basicMarks, 139, dataTransfer);
    flushFrames(1);

    expect(listbox.scrollTop).toBe(scrolledTop);
  });

  it("stops scrolling on list drop", () => {
    useSettingsStore.setState({
      toolbarConfig: {
        start: TEST_CONFIG.start,
        end: [
          {
            kind: "group",
            id: "find",
            toolbarVisible: true,
            floatingVisible: false,
          },
        ],
      },
    });
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const listbox = screen.getByRole("listbox", {
      name: "toolbar.settings.title",
    });
    setupLaneGeometry(listbox, 100);
    const history = screen.getByRole("option", {
      name: /toolbar\.groups\.history/,
    });
    const dataTransfer = makeDataTransfer();

    fireEvent.dragStart(
      within(history).getByLabelText("toolbar.settings.dragHandle"),
      { dataTransfer }
    );
    dragOverWithClientY(listbox, 495, dataTransfer);
    flushFrames(1);
    const scrolledTop = listbox.scrollTop;
    expect(scrolledTop).toBeGreaterThan(100);

    fireEvent.drop(listbox, { dataTransfer });
    flushFrames(1);

    expect(listbox.scrollTop).toBe(scrolledTop);
  });

  it("stops scrolling on drag end", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const listbox = screen.getByRole("listbox", {
      name: "toolbar.settings.title",
    });
    setupLaneGeometry(listbox, 100);
    const history = screen.getByRole("option", {
      name: /toolbar\.groups\.history/,
    });
    const dataTransfer = makeDataTransfer();

    fireEvent.dragStart(
      within(history).getByLabelText("toolbar.settings.dragHandle"),
      { dataTransfer }
    );
    dragOverWithClientY(listbox, 495, dataTransfer);
    flushFrames(1);
    const scrolledTop = listbox.scrollTop;
    expect(scrolledTop).toBeGreaterThan(100);

    window.dispatchEvent(new Event("dragend", { bubbles: true }));
    flushFrames(1);

    expect(listbox.scrollTop).toBe(scrolledTop);
  });
});

describe("column headers and tooltips", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => vi.runOnlyPendingTimers());
    vi.useRealTimers();
  });

  it("renders five localized column headers once", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
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

  it("shares the same grid template and minimum width between header, listbox, and rows inside a horizontal scroll viewport", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const listbox = screen.getByRole("listbox", {
      name: "toolbar.settings.title",
    });
    const viewport = listbox.parentElement as HTMLElement;
    expect(viewport).toHaveClass("overflow-x-auto");
    expect(listbox).toHaveClass(TOOLBAR_SETTINGS_ROW_MIN_WIDTH);

    const header = viewport.firstElementChild as HTMLElement;
    expect(header).toHaveClass(
      TOOLBAR_SETTINGS_ROW_GRID,
      TOOLBAR_SETTINGS_ROW_MIN_WIDTH
    );

    const history = screen.getByRole("option", {
      name: /toolbar\.groups\.history/,
    });
    expect(history).toHaveClass(
      TOOLBAR_SETTINGS_ROW_GRID,
      TOOLBAR_SETTINGS_ROW_MIN_WIDTH
    );

    const divider = screen.getByRole("option", {
      name: "toolbar.settings.dividerLabel",
    });
    expect(divider).toHaveClass(
      TOOLBAR_SETTINGS_ROW_GRID,
      TOOLBAR_SETTINGS_ROW_MIN_WIDTH
    );
  });

  it("places group controls and divider placeholders under the intended columns", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const history = screen.getByRole("option", {
      name: /toolbar\.groups\.history/,
    });
    expect(history.children).toHaveLength(5);
    expect(
      within(history.children[0] as HTMLElement).getByLabelText(
        "toolbar.settings.dragHandle"
      )
    ).toBeInTheDocument();
    expect(
      within(history.children[1] as HTMLElement).getByRole("switch", {
        name: "toolbar.settings.toolbarVisible",
      })
    ).toBeInTheDocument();
    expect(
      within(history.children[2] as HTMLElement).getByRole("switch", {
        name: "toolbar.settings.floatingUnavailable",
      })
    ).toBeInTheDocument();
    expect(
      within(history.children[3] as HTMLElement).getAllByRole("button")
    ).toHaveLength(2);
    expect(history.children[4].tagName).toBe("SPAN");
    expect(history.children[4]).toHaveAttribute("aria-hidden", "true");

    const divider = screen.getByRole("option", {
      name: "toolbar.settings.dividerLabel",
    });
    expect(divider.children).toHaveLength(5);
    expect(
      within(divider.children[0] as HTMLElement).getByLabelText(
        "toolbar.settings.dragHandle"
      )
    ).toBeInTheDocument();
    expect(divider.children[1]).toHaveAttribute("aria-hidden", "true");
    expect(divider.children[2]).toHaveAttribute("aria-hidden", "true");
    expect(
      within(divider.children[3] as HTMLElement).getAllByRole("button")
    ).toHaveLength(2);
    expect(
      within(divider.children[4] as HTMLElement).getByRole("button", {
        name: "toolbar.settings.remove",
      })
    ).toBeInTheDocument();
  });

  it("retains localized accessible names for icon-only controls", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    expect(screen.getAllByLabelText("toolbar.settings.dragHandle")).toHaveLength(3);
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
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
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
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const itemHeader = screen.getByText("toolbar.settings.itemColumn");
    fireEvent.mouseEnter(itemHeader);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "toolbar.settings.itemColumnHelp"
    );
  });

  it("prevents text selection on draggable rows", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const history = screen.getByRole("option", { name: /toolbar\.groups\.history/ });
    const divider = screen.getByRole("option", { name: "toolbar.settings.dividerLabel" });
    expect(history).toHaveClass("select-none");
    expect(divider).toHaveClass("select-none");
  });

  it("exposes control tooltips when an icon-only button is hovered", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
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
