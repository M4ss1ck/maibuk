import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
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

it("adds a divider then removes it", () => {
  render(<ToolbarSettingsDialog isOpen onClose={vi.fn()} />);
  const addDividerButtons = screen.getAllByRole("button", {
    name: "toolbar.settings.addDivider",
  });
  // Start section's Add-divider button is first.
  fireEvent.click(addDividerButtons[0]);

  const afterAdd = useSettingsStore.getState().toolbarConfig.start;
  expect(afterAdd).toHaveLength(TEST_CONFIG.start.length + 1);
  const newDivider = afterAdd[afterAdd.length - 1];
  expect(newDivider.kind).toBe("divider");

  const removeButtons = screen.getAllByRole("button", {
    name: "toolbar.settings.remove",
  });
  fireEvent.click(removeButtons[removeButtons.length - 1]);

  const afterRemove = useSettingsStore.getState().toolbarConfig.start;
  expect(afterRemove).toHaveLength(TEST_CONFIG.start.length);
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
