import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolbarSettingsDialog } from "@/components/editor/toolbar/ToolbarSettingsDialog";
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

it("renders two sections with icons and labels for each entry", () => {
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  expect(screen.getByText("toolbar.settings.start")).toBeInTheDocument();
  expect(screen.getByText("toolbar.settings.end")).toBeInTheDocument();
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

    const endLane = screen.getByRole("listbox", {
      name: "toolbar.settings.end",
    });
    expect(
      within(endLane).queryByRole("button", {
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

it("transfers an entry to the other section", () => {
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  const transferButtons = screen.getAllByRole("button", {
    name: "toolbar.settings.transferToEnd",
  });
  fireEvent.click(transferButtons[0]);

  const state = useSettingsStore.getState().toolbarConfig;
  expect(state.start).toHaveLength(TEST_CONFIG.start.length - 1);
  expect(state.end).toHaveLength(1);
  expect(state.end[0].kind === "group" && state.end[0].id).toBe("history");
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

it("transfers with ArrowRight and announces the new position", () => {
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  const history = screen.getByRole("option", { name: /toolbar\.groups\.history/ });

  history.focus();
  fireEvent.keyDown(history, { key: "ArrowRight" });

  const movedHistory = screen.getByRole("option", { name: /toolbar\.groups\.history/ });
  expect(movedHistory).toHaveFocus();
  expect(movedHistory).toHaveAttribute("aria-posinset", "1");
  expect(useSettingsStore.getState().toolbarConfig.end[0]).toMatchObject({
    kind: "group",
    id: "history",
  });
  expect(screen.getByRole("status")).toHaveTextContent("toolbar.settings.moved");
});

it("keeps one tabbable option in each non-empty listbox", () => {
  useSettingsStore.setState({
    toolbarConfig: {
      start: [TEST_CONFIG.start[0]],
      end: [TEST_CONFIG.start[2]],
    },
  });
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);

  const listboxes = screen.getAllByRole("listbox");
  for (const listbox of listboxes) {
    expect(
      within(listbox)
        .getAllByRole("option")
        .filter((option) => option.tabIndex === 0)
    ).toHaveLength(1);
  }
});

it("falls back to another tabbable option when the active entry is removed", () => {
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  const divider = screen.getByRole("option", { name: "toolbar.settings.dividerLabel" });
  divider.focus();

  fireEvent.click(within(divider).getByRole("button", { name: "toolbar.settings.remove" }));

  const startListbox = screen.getByRole("listbox", { name: "toolbar.settings.start" });
  expect(
    within(startListbox)
      .getAllByRole("option")
      .filter((option) => option.tabIndex === 0)
  ).toHaveLength(1);
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

it("moves an entry across sections by dropping on the empty lane area", () => {
  const originalMove = useSettingsStore.getState().moveToolbarEntryTo;
  const moveToolbarEntryTo = vi.fn(originalMove);
  useSettingsStore.setState({ moveToolbarEntryTo });
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  const history = screen.getByRole("option", { name: /toolbar\.groups\.history/ });
  const endLane = screen.getByRole("listbox", { name: "toolbar.settings.end" });
  const dataTransfer = {
    effectAllowed: "none",
    dropEffect: "none",
    setData: vi.fn(),
  };

  fireEvent.dragStart(
    within(history).getByLabelText("toolbar.settings.dragHandle"),
    { dataTransfer }
  );
  fireEvent.dragOver(endLane, { dataTransfer });
  fireEvent.drop(endLane, { dataTransfer });

  expect(moveToolbarEntryTo).toHaveBeenCalledWith("start", 0, "end", 0);
  expect(useSettingsStore.getState().toolbarConfig.end).toEqual([
    expect.objectContaining({ id: "history" }),
  ]);
  useSettingsStore.setState({ moveToolbarEntryTo: originalMove });
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
      frames.forEach((frame) => frame.cb(0));
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

  it("renders bounded overflow-y-auto listboxes", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const startLane = screen.getByRole("listbox", {
      name: "toolbar.settings.start",
    });
    expect(startLane).toHaveClass("min-h-8", "max-h-[55vh]", "overflow-y-auto");
  });

  it("scrolls downward when dragging near the bottom of a lane", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const startLane = screen.getByRole("listbox", {
      name: "toolbar.settings.start",
    });
    setupLaneGeometry(startLane, 100);
    const history = screen.getByRole("option", {
      name: /toolbar\.groups\.history/,
    });
    const dataTransfer = makeDataTransfer();

    fireEvent.dragStart(
      within(history).getByLabelText("toolbar.settings.dragHandle"),
      { dataTransfer }
    );
    dragOverWithClientY(startLane, 495, dataTransfer);
    flushFrames(1);

    expect(startLane.scrollTop).toBeGreaterThan(100);
  });

  it("scrolls upward when dragging near the top of a lane", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const startLane = screen.getByRole("listbox", {
      name: "toolbar.settings.start",
    });
    setupLaneGeometry(startLane, 100);
    const history = screen.getByRole("option", {
      name: /toolbar\.groups\.history/,
    });
    const dataTransfer = makeDataTransfer();

    fireEvent.dragStart(
      within(history).getByLabelText("toolbar.settings.dragHandle"),
      { dataTransfer }
    );
    dragOverWithClientY(startLane, 8, dataTransfer);
    flushFrames(1);

    expect(startLane.scrollTop).toBeLessThan(100);
  });

  it("stops scrolling on row drop", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const startLane = screen.getByRole("listbox", {
      name: "toolbar.settings.start",
    });
    setupLaneGeometry(startLane, 100);
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
    const scrolledTop = startLane.scrollTop;
    expect(scrolledTop).toBeGreaterThan(100);

    dropWithClientY(basicMarks, 139, dataTransfer);
    flushFrames(1);

    expect(startLane.scrollTop).toBe(scrolledTop);
  });

  it("stops scrolling on lane drop", () => {
    useSettingsStore.setState({
      toolbarConfig: {
        start: TEST_CONFIG.start,
        end: TEST_CONFIG.start,
      },
    });
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const startLane = screen.getByRole("listbox", {
      name: "toolbar.settings.start",
    });
    const endLane = screen.getByRole("listbox", {
      name: "toolbar.settings.end",
    });
    setupLaneGeometry(endLane, 100);
    const history = within(startLane).getByRole("option", {
      name: /toolbar\.groups\.history/,
    });
    const dataTransfer = makeDataTransfer();

    fireEvent.dragStart(
      within(history).getByLabelText("toolbar.settings.dragHandle"),
      { dataTransfer }
    );
    dragOverWithClientY(endLane, 495, dataTransfer);
    flushFrames(1);
    const scrolledTop = endLane.scrollTop;
    expect(scrolledTop).toBeGreaterThan(100);

    fireEvent.drop(endLane, { dataTransfer });
    flushFrames(1);

    expect(endLane.scrollTop).toBe(scrolledTop);
  });

  it("stops scrolling on drag end", () => {
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const startLane = screen.getByRole("listbox", {
      name: "toolbar.settings.start",
    });
    setupLaneGeometry(startLane, 100);
    const history = screen.getByRole("option", {
      name: /toolbar\.groups\.history/,
    });
    const dataTransfer = makeDataTransfer();

    fireEvent.dragStart(
      within(history).getByLabelText("toolbar.settings.dragHandle"),
      { dataTransfer }
    );
    dragOverWithClientY(startLane, 495, dataTransfer);
    flushFrames(1);
    const scrolledTop = startLane.scrollTop;
    expect(scrolledTop).toBeGreaterThan(100);

    window.dispatchEvent(new Event("dragend", { bubbles: true }));
    flushFrames(1);

    expect(startLane.scrollTop).toBe(scrolledTop);
  });

  it("stops the other lane's auto-scroll when drag ends without dropping", () => {
    useSettingsStore.setState({
      toolbarConfig: {
        start: TEST_CONFIG.start,
        end: TEST_CONFIG.start,
      },
    });
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const startLane = screen.getByRole("listbox", {
      name: "toolbar.settings.start",
    });
    const endLane = screen.getByRole("listbox", {
      name: "toolbar.settings.end",
    });
    setupLaneGeometry(startLane, 100);
    setupLaneGeometry(endLane, 100);
    const history = within(startLane).getByRole("option", {
      name: /toolbar\.groups\.history/,
    });
    const dataTransfer = makeDataTransfer();

    fireEvent.dragStart(
      within(history).getByLabelText("toolbar.settings.dragHandle"),
      { dataTransfer }
    );
    dragOverWithClientY(endLane, 495, dataTransfer);
    flushFrames(1);
    expect(endLane.scrollTop).toBeGreaterThan(100);
    const endScrolledTop = endLane.scrollTop;

    window.dispatchEvent(new Event("dragend", { bubbles: true }));
    flushFrames(1);

    expect(endLane.scrollTop).toBe(endScrolledTop);
    expect(startLane.scrollTop).toBe(100);
  });

  it("stops the destination lane before applying a cross-lane move", () => {
    useSettingsStore.setState({
      toolbarConfig: {
        start: TEST_CONFIG.start,
        end: TEST_CONFIG.start,
      },
    });
    const originalMove = useSettingsStore.getState().moveToolbarEntryTo;
    const moveToolbarEntryTo = vi.fn((...args: Parameters<typeof originalMove>) => {
      originalMove(...args);
    });
    useSettingsStore.setState({ moveToolbarEntryTo });
    render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
    const startLane = screen.getByRole("listbox", {
      name: "toolbar.settings.start",
    });
    const endLane = screen.getByRole("listbox", {
      name: "toolbar.settings.end",
    });
    setupLaneGeometry(endLane, 100);
    const history = within(startLane).getByRole("option", {
      name: /toolbar\.groups\.history/,
    });
    const dataTransfer = makeDataTransfer();

    fireEvent.dragStart(
      within(history).getByLabelText("toolbar.settings.dragHandle"),
      { dataTransfer }
    );
    dragOverWithClientY(endLane, 495, dataTransfer);
    flushFrames(1);
    const scrolledTop = endLane.scrollTop;
    expect(scrolledTop).toBeGreaterThan(100);

    fireEvent.drop(endLane, { dataTransfer });
    flushFrames(1);

    expect(moveToolbarEntryTo).toHaveBeenCalledWith("start", 0, "end", 3);
    expect(endLane.scrollTop).toBe(scrolledTop);
    useSettingsStore.setState({ moveToolbarEntryTo: originalMove });
  });
});
