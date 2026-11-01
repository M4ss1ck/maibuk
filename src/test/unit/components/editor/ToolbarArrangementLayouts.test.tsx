import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolbarSettingsDialog } from "@/components/editor/toolbar/ToolbarSettingsDialog";
import {
  previewAcceptsDrop,
  previewSlotOfDropTarget,
  verticalMoveTarget,
} from "@/components/editor/toolbar/ToolbarArrangementLayouts";
import { useSettingsStore } from "@/features/settings/store";
import {
  displayedToolbarEntries,
  type ToolbarConfig,
  type ToolbarEntry,
} from "@/features/settings/toolbar-config";
import { createDataTransfer, dispatchDragEvent } from "@/test/support/drag-events";
import { makeToolbarEditor } from "@/test/support/toolbar-editor";

vi.mock("@tiptap/react", () => ({
  useEditorState: ({
    editor,
    selector,
  }: {
    editor: unknown;
    selector: (value: { editor: unknown }) => unknown;
  }) => selector({ editor }),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const group = (id: string, toolbarVisible = true) =>
  ({ kind: "group", id, toolbarVisible }) as ToolbarEntry;
const divider = (id: string): ToolbarEntry => ({ kind: "divider", id });

function setConfig(config: Partial<ToolbarConfig>) {
  useSettingsStore.setState({
    toolbarConfig: {
      start: [
        group("history"),
        divider("d1"),
        group("font"),
        group("find", false),
        group("basic-marks"),
        divider("d2"),
        group("headings"),
      ],
      end: [],
      selectionToolbar: ["basic-marks", "headings"],
      ...config,
    },
  });
}

beforeEach(() => setConfig({}));

function renderDialog(onClose = vi.fn()) {
  const view = render(
    <MemoryRouter>
      <ToolbarSettingsDialog editor={makeToolbarEditor()} isOpen={true} onClose={onClose} />
    </MemoryRouter>
  );
  return { ...view, onClose };
}

const preview = () => screen.getByRole("listbox", { name: "toolbar.settings.toolbarPreview" });
const tray = () => screen.getByRole("listbox", { name: "toolbar.settings.trayHidden" });
const option = (container: HTMLElement, name: string) =>
  within(container).getByRole("option", { name });
const startIds = () => useSettingsStore.getState().toolbarConfig.start.map((entry) => entry.id);
const shownStart = () =>
  displayedToolbarEntries(useSettingsStore.getState().toolbarConfig.start).map((entry) => entry.id);
const status = () => screen.getByRole("status", { hidden: true });

describe("the Customize toolbar dialog's chrome", () => {
  it("opens on the Toolbar layout every time, whatever was chosen last", async () => {
    const user = userEvent.setup();
    const view = renderDialog();
    expect(preview()).toBeInTheDocument();

    act(() => screen.getByRole("radio", { name: "toolbar.settings.layoutToolbar" }).focus());
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("radio", { name: "toolbar.settings.layoutList" })).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.getByRole("grid", { name: "toolbar.settings.start" })).toBeInTheDocument();

    view.rerender(
      <MemoryRouter>
        <ToolbarSettingsDialog editor={makeToolbarEditor()} isOpen={false} onClose={vi.fn()} />
      </MemoryRouter>
    );
    view.rerender(
      <MemoryRouter>
        <ToolbarSettingsDialog editor={makeToolbarEditor()} isOpen={true} onClose={vi.fn()} />
      </MemoryRouter>
    );
    expect(preview()).toBeInTheDocument();
  });

  it("resets both toolbars from the header after a confirm step", async () => {
    const user = userEvent.setup();
    setConfig({ selectionToolbar: [] });
    renderDialog();
    const reset = screen.getByRole("button", { name: "toolbar.settings.reset" });
    act(() => reset.focus());
    await user.keyboard("{Enter}");
    expect(useSettingsStore.getState().toolbarConfig.selectionToolbar).toEqual([]);
    await user.keyboard("{Enter}");
    expect(useSettingsStore.getState().toolbarConfig.selectionToolbar).toEqual([
      "basic-marks",
      "headings",
      "highlight",
      "link-code",
    ]);
    expect(startIds()).toContain("find");
    await waitFor(() => expect(status()).toHaveTextContent("toolbar.settings.resetDone"));
  });
});

describe("the Toolbar layout by keyboard", () => {
  it("picks a button up with Enter, moves it with the arrows live, and drops it with Enter", async () => {
    const user = userEvent.setup();
    renderDialog();
    act(() => option(preview(), "toolbar.groups.font").focus());

    await user.keyboard("{Enter}");
    await waitFor(() => expect(status()).toHaveTextContent("toolbar.settings.pickedUp"));
    await user.keyboard("{ArrowLeft}");
    // The preview follows the arrow before the drop.
    expect(shownStart()).toEqual(["history", "font", "d1", "basic-marks", "d2", "headings"]);
    expect(option(preview(), "toolbar.groups.font")).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(startIds()).toEqual(["history", "font", "d1", "find", "basic-marks", "d2", "headings"]);
    await waitFor(() => expect(status()).toHaveTextContent("toolbar.settings.dropped"));
    expect(option(preview(), "toolbar.groups.font")).toHaveFocus();
  });

  it("crosses from Start into End at the boundary", async () => {
    const user = userEvent.setup();
    renderDialog();
    act(() => option(preview(), "toolbar.groups.headings").focus());

    await user.keyboard("{Enter}{ArrowRight}{Enter}");
    const config = useSettingsStore.getState().toolbarConfig;
    expect(config.end.map((entry) => entry.id)).toEqual(["headings"]);
    expect(config.start.map((entry) => entry.id)).not.toContain("headings");
  });

  it("puts the button back with Escape, keeping the dialog open", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    const before = startIds();
    act(() => option(preview(), "toolbar.groups.font").focus());

    await user.keyboard("{Enter}{ArrowLeft}{ArrowLeft}");
    expect(startIds()).not.toEqual(before);
    await user.keyboard("{Escape}");

    expect(startIds()).toEqual(before);
    expect(onClose).not.toHaveBeenCalled();
    expect(option(preview(), "toolbar.groups.font")).toHaveFocus();
    await waitFor(() => expect(status()).toHaveTextContent("toolbar.settings.cancelled"));
  });

  it("hides a button carried down into the tray", async () => {
    const user = userEvent.setup();
    renderDialog();
    act(() => option(preview(), "toolbar.groups.font").focus());

    await user.keyboard("{Enter}{ArrowDown}");
    expect(option(tray(), "toolbar.groups.font")).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(useSettingsStore.getState().toolbarConfig.start[2]).toEqual(group("font", false));
    expect(within(preview()).queryByRole("option", { name: "toolbar.groups.font" })).toBeNull();
    await waitFor(() => expect(status()).toHaveTextContent("toolbar.settings.hidden"));
  });

  it("shows a hidden button carried up out of the tray", async () => {
    const user = userEvent.setup();
    renderDialog();
    act(() => option(tray(), "toolbar.groups.find").focus());

    await user.keyboard("{Enter}{ArrowUp}");
    expect(option(preview(), "toolbar.groups.find")).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(useSettingsStore.getState().toolbarConfig.start[0]).toEqual(group("find"));
  });

  it("adds a divider from the Divider source, skipping slots beside another divider", async () => {
    const user = userEvent.setup();
    renderDialog();
    act(() => option(tray(), "toolbar.settings.dividerSource").focus());

    await user.keyboard("{Enter}{ArrowUp}");
    // Every slot right of here sits beside a divider or at the lane's end.
    await user.keyboard("{ArrowRight}{ArrowRight}");
    await user.keyboard("{Enter}");

    const shown = displayedToolbarEntries(useSettingsStore.getState().toolbarConfig.start);
    expect(shown.map((entry) => entry.kind)).toEqual([
      "group",
      "divider",
      "group",
      "divider",
      "group",
      "divider",
      "group",
    ]);
    expect(shown[3].id).toMatch(/^divider-/);
    expect(shown[2].id).toBe("font");
  });

  it("deletes a divider carried into the tray, focus waiting on the Divider source", async () => {
    const user = userEvent.setup();
    renderDialog();
    act(() =>
      within(preview()).getAllByRole("option", { name: "toolbar.settings.dividerLabel" })[0].focus()
    );

    await user.keyboard("{Enter}{ArrowDown}");
    // Carried into the tray, the divider has no option; the Divider source holds focus.
    expect(option(tray(), "toolbar.settings.dividerSource")).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(startIds()).not.toContain("d1");
    expect(option(tray(), "toolbar.settings.dividerSource")).toHaveFocus();
    await waitFor(() => expect(status()).toHaveTextContent("toolbar.settings.dividerRemoved"));
  });

  it("never carries a divider into an empty End by the arrows", async () => {
    const user = userEvent.setup();
    setConfig({ start: [group("history"), divider("d1"), group("font")], end: [] });
    // The empty End's slot sits on a row of its own below the Start buttons.
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element
    ) {
      const key = (this as HTMLElement).dataset?.key;
      return new DOMRect(key === "end-slot" ? 0 : 50, key === "end-slot" ? 40 : 0, 30, 20);
    });
    try {
      renderDialog();
      act(() =>
        within(preview()).getByRole("option", { name: "toolbar.settings.dividerLabel" }).focus()
      );
      await user.keyboard("{Enter}{ArrowDown}");

      expect(useSettingsStore.getState().toolbarConfig.end).toEqual([]);
      expect(option(tray(), "toolbar.settings.dividerSource")).toHaveFocus();
    } finally {
      rect.mockRestore();
    }
  });

  it("merges two dividers a move left side by side when it drops", async () => {
    const user = userEvent.setup();
    setConfig({
      start: [group("history"), divider("d1"), group("font"), divider("d2"), group("find")],
    });
    renderDialog();
    act(() => option(preview(), "toolbar.groups.font").focus());

    await user.keyboard("{Enter}{ArrowDown}{Enter}");

    expect(startIds()).toEqual(["history", "d1", "font", "find"]);
  });

  it("owns the arrows only while a button is carried", async () => {
    const user = userEvent.setup();
    renderDialog();
    const layout = preview().closest("[data-owns-arrows]") ?? preview().parentElement;
    act(() => option(preview(), "toolbar.groups.font").focus());
    expect(document.querySelector("[data-owns-arrows]")).toBeNull();

    await user.keyboard("{Enter}");
    expect(document.querySelector("[data-owns-arrows]")).not.toBeNull();
    await user.keyboard("{Enter}");
    expect(document.querySelector("[data-owns-arrows]")).toBeNull();
    expect(layout).not.toBeNull();
  });
});

describe("the Selection layout by keyboard", () => {
  async function openSelection(user: ReturnType<typeof userEvent.setup>) {
    renderDialog();
    act(() => screen.getByRole("radio", { name: "toolbar.settings.layoutToolbar" }).focus());
    await user.keyboard("{ArrowRight} ");
    return {
      bubble: screen.getByRole("listbox", { name: "toolbar.settings.selectionPreview" }),
      selectionTray: screen.getByRole("listbox", { name: "toolbar.settings.traySelection" }),
    };
  }
  const selection = () => useSettingsStore.getState().toolbarConfig.selectionToolbar;

  it("reorders the Selection Toolbar without touching the Editor Toolbar", async () => {
    const user = userEvent.setup();
    const { bubble } = await openSelection(user);
    const editorOrder = startIds();
    act(() => option(bubble, "toolbar.groups.headings").focus());

    await user.keyboard("{Enter}{ArrowLeft}{Enter}");

    expect(selection()).toEqual(["headings", "basic-marks"]);
    expect(startIds()).toEqual(editorOrder);
  });

  it("adds a button from its tray and takes one out into it", async () => {
    const user = userEvent.setup();
    const { selectionTray } = await openSelection(user);
    expect(
      within(selectionTray)
        .getAllByRole("option")
        .map((el) => el.dataset.key)
    ).toEqual(["highlight", "link-code"]);
    act(() => option(selectionTray, "toolbar.groups.highlight").focus());

    await user.keyboard("{Enter}{ArrowUp}{Enter}");
    expect(selection()).toEqual(["highlight", "basic-marks", "headings"]);

    const bubble = screen.getByRole("listbox", { name: "toolbar.settings.selectionPreview" });
    act(() => option(bubble, "toolbar.groups.basicMarks").focus());
    await user.keyboard("{Enter}{ArrowDown}{Enter}");
    expect(selection()).toEqual(["highlight", "headings"]);
    await waitFor(() => expect(status()).toHaveTextContent("toolbar.settings.takenOut"));
  });

  it("puts a button back with Escape", async () => {
    const user = userEvent.setup();
    const { bubble } = await openSelection(user);
    act(() => option(bubble, "toolbar.groups.headings").focus());

    await user.keyboard("{Enter}{ArrowDown}{Escape}");

    expect(selection()).toEqual(["basic-marks", "headings"]);
  });
});

describe("moving a carried button between wrapped preview rows", () => {
  // A row's last slot and the next row's first slot are the same slot.
  const item = (left: number, top: number, before: number | null, after: number | null) => ({
    rect: new DOMRect(left, top, 40, 20),
    before,
    after,
  });
  const same = (a: number, b: number) => a === b;

  it("skips the slot it already holds and takes the next nearest one", () => {
    const items = [item(0, 0, 0, 1), item(50, 40, 1, 2), item(200, 40, 2, 3)];
    // Carried at slot 1, drawn at the end of the first row.
    expect(verticalMoveTarget(items, { x: 60, y: 10 }, 1, 1, same)).toBe(2);
  });

  it("leaves for the tray when the only slot below is the one it holds", () => {
    const items = [item(0, 0, 0, 1), item(0, 40, 1, null), item(200, 40, null, null)];
    expect(verticalMoveTarget(items, { x: 60, y: 10 }, 1, 1, same)).toBe("tray");
  });

  it("stays put going up from the top row, and comes up from the tray to the last row", () => {
    const items = [item(0, 0, 0, 1), item(0, 40, 1, 2)];
    expect(verticalMoveTarget(items, { x: 0, y: 10 }, 0, -1, same)).toBeNull();
    expect(verticalMoveTarget(items, { x: 45, y: 200 }, "tray", -1, same)).toBe(2);
    expect(verticalMoveTarget(items, { x: 45, y: 200 }, "tray", 1, same)).toBeNull();
  });
});

describe("the Toolbar layout by pointer (React Aria drag-and-drop)", () => {
  function dragTo(source: HTMLElement, target: HTMLElement) {
    const dataTransfer = createDataTransfer();
    dispatchDragEvent(source, "dragstart", dataTransfer, 10);
    dispatchDragEvent(target, "dragenter", dataTransfer, 10);
    dispatchDragEvent(target, "dragover", dataTransfer, 10);
    dispatchDragEvent(target, "drop", dataTransfer, 10);
    dispatchDragEvent(source, "dragend", dataTransfer, 10);
  }

  it("hides a button dropped on the tray", async () => {
    renderDialog();
    dragTo(option(preview(), "toolbar.groups.font"), tray());
    await waitFor(() =>
      expect(useSettingsStore.getState().toolbarConfig.start[2]).toEqual(group("font", false))
    );
  });

  it("deletes a divider dropped outside the toolbar", async () => {
    renderDialog();
    const [first] = within(preview()).getAllByRole("option", {
      name: "toolbar.settings.dividerLabel",
    });
    dragTo(first, screen.getByText("toolbar.settings.toolbarHint"));
    await waitFor(() => expect(startIds()).not.toContain("d1"));
  });

  it("maps a drop target to the slot the author sees, leaving out the dragged button", () => {
    setConfig({});
    const config = useSettingsStore.getState().toolbarConfig;
    expect(
      previewSlotOfDropTarget(
        config,
        { type: "item", key: "basic-marks", dropPosition: "before" },
        "history"
      )
      // Without History, the leading divider is not shown: Font, Basic marks...
    ).toEqual({ section: "start", index: 1 });
    expect(
      previewSlotOfDropTarget(
        config,
        { type: "item", key: "fixed", dropPosition: "before" },
        "history"
      )
    ).toEqual({ section: "end", index: 0 });
    expect(
      previewSlotOfDropTarget(
        config,
        { type: "item", key: "fixed", dropPosition: "after" },
        "history"
      )
    ).toBeNull();
    expect(
      previewSlotOfDropTarget(
        config,
        { type: "item", key: "end-slot", dropPosition: "before" },
        "font"
      )
    ).toEqual({ section: "end", index: 0 });
  });

  it("refuses a divider beside another divider or at a lane's end", () => {
    const config = useSettingsStore.getState().toolbarConfig;
    const at = (index: number) => ({ section: "start" as const, index });
    expect(previewAcceptsDrop(config, at(2), "divider-source")).toBe(false);
    expect(previewAcceptsDrop(config, at(0), "divider-source")).toBe(false);
    expect(previewAcceptsDrop(config, at(3), "divider-source")).toBe(true);
    expect(previewAcceptsDrop(config, at(2), "font")).toBe(true);
  });
});

it("keeps the Close button and the List layout working beside the previews", () => {
  const { onClose } = renderDialog();
  fireEvent.click(screen.getByRole("button", { name: "toolbar.settings.close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
