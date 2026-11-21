import { type ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";
import en from "./locales/runtime/en.json";
import { MAP_LABEL_FONT_FAMILIES, mapKey, type MapLineElement } from "./maps";
import { MAP_PAGE_ID, MAPS_PAGE_ID, MOVE_RIGHT } from "./runtime";
import {
  frameHostFor,
  recordingPort,
  isFontMessage,
  line,
  mapStorage,
  storedMap,
  registerMapCommands,
  CommandKeys,
  openEditor,
  selectRow,
  chooseRowMenu,
  focusPanelButton,
  linePoints,
  tabTo,
  pickTool,
  pickedTool,
  placeShape,
  pickOption,
} from "./test-support";

// A focused button opens its Tooltip, and Floating UI then reads computed
// style up the whole ancestor chain: in jsdom that was 38% of a keyboard
// test's time (#850). No test here asserts a Tooltip, so it renders its child.
vi.mock("@/components/ui/Tooltip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/Tooltip")>()),
  Tooltip: ({ children }: { children: ReactElement }) => children,
}));

describe("Map editor page", () => {
  it("shows Sides only for a polygon and Corner radius only for a rectangle", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      const sides = () => screen.queryByRole("textbox", { name: en["properties.shape.sides"] });
      const cornerRadius = () =>
        screen.queryByRole("textbox", { name: en["properties.shape.cornerRadius"] });

      await placeShape(user, "polygon");
      const sidesField = await screen.findByRole("textbox", {
        name: en["properties.shape.sides"],
      });
      expect(cornerRadius()).not.toBeInTheDocument();

      // ArrowUp steps the side count, and the Shape follows.
      await tabTo(user, sidesField, 120);
      await user.keyboard("{ArrowUp}");
      await waitFor(() => expect(runtime.editor?.getSnapshot().selectedShape?.sides).toBe(7));

      // The belt holds the next Shape too, one Tab stop away.
      await pickTool(user, en["tools.rectangle"]);
      const place = await screen.findByRole("button", {
        name: en["properties.placeShape.rectangle"],
      });
      await tabTo(user, place, 120);
      await user.keyboard("{Enter}");

      const radiusField = await screen.findByRole("textbox", {
        name: en["properties.shape.cornerRadius"],
      });
      expect(sides()).not.toBeInTheDocument();
      await tabTo(user, radiusField, 120);
      await user.keyboard("{Control>}a{/Control}2{Enter}");
      await waitFor(() =>
        expect(runtime.editor?.getSnapshot().selectedShape?.cornerRadius).toBe(2)
      );

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("says which Shape a line was converted from after Roughen", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await placeShape(user, "ellipse");
      expect(screen.queryByText(en["properties.convertedFrom.ellipse"])).not.toBeInTheDocument();

      const roughenButton = await screen.findByRole("button", { name: en["properties.roughen"] });
      await tabTo(user, roughenButton, 120);
      await user.keyboard("{Enter}");

      await screen.findByText(en["properties.convertedFrom.ellipse"]);
      expect(runtime.editor?.getSnapshot().selectedConvertedFrom).toBe("ellipse");
      // The line is point by point now, so its number fields are gone.
      expect(
        screen.queryByRole("textbox", { name: en["properties.shape.width"] })
      ).not.toBeInTheDocument();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("disables the Shape number fields while the line is locked", async () => {
    const storage = mapStorage([]);
    const { host } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await placeShape(user, "ellipse");
      const width = await screen.findByRole("textbox", {
        name: en["properties.shape.width"],
      });
      expect(width).toBeEnabled();

      const locked = screen.getByRole("button", { name: en["properties.locked"] });
      expect(locked).toHaveAttribute("aria-pressed", "false");
      await tabTo(user, locked, 120);
      await user.keyboard(" ");
      await waitFor(() => expect(locked).toHaveAttribute("aria-pressed", "true"));
      await waitFor(() =>
        expect(screen.getByRole("textbox", { name: en["properties.shape.width"] })).toBeDisabled()
      );

      await user.keyboard(" ");
      await waitFor(() =>
        expect(screen.getByRole("textbox", { name: en["properties.shape.width"] })).toBeEnabled()
      );

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("selects each Shape tool by its key and its Place button appears", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup({ delay: null });
      await screen.findByRole("button", { name: en["tools.polygon"] });
      await focusPanelButton(user);

      const tools = [
        ["o", "ellipse", en["tools.ellipse"]],
        ["r", "rectangle", en["tools.rectangle"]],
        ["s", "polygon", en["tools.polygon"]],
      ] as const;
      for (const [key, tool, label] of tools) {
        await user.keyboard(key);
        await waitFor(() => expect(runtime.editor?.getSnapshot().tool).toBe(tool));
        await waitFor(() => expect(pickedTool(label)).toHaveAttribute("aria-pressed", "true"));
        await screen.findByRole("button", { name: en[`properties.placeShape.${tool}`] });
      }

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("selects the Hand by its key and from the belt, and drops the selection", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup({ delay: null });
      await screen.findByRole("button", { name: en["tools.hand"] });
      runtime.editor?.select("e1");
      await focusPanelButton(user);

      await user.keyboard("h");
      await waitFor(() => expect(runtime.editor?.getSnapshot().tool).toBe("hand"));
      await waitFor(() =>
        expect(pickedTool(en["tools.hand"])).toHaveAttribute("aria-pressed", "true")
      );
      // Only the Select tool works on a selection, so picking the Hand drops it.
      expect(runtime.editor?.getSnapshot().selectedId).toBeNull();

      await user.keyboard("v");
      await waitFor(() => expect(runtime.editor?.getSnapshot().tool).toBe("select"));
      await pickTool(user, en["tools.hand"]);
      expect(runtime.editor?.getSnapshot().tool).toBe("hand");

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("changes the selected line's Line style and Encloses Fills from the properties panel", async () => {
    const storage = mapStorage([
      line(
        "e1",
        "Road",
        [
          [10, 10],
          [20, 20],
        ],
        { style: "road", enclosesFills: false }
      ),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      // With the Pen picked and no Map Line selected, Properties shows the style
      // the next line takes (#778); selecting one shows that line's own.
      await pickTool(user, en["tools.pen"]);
      await waitFor(() =>
        expect(screen.getByLabelText(en["properties.lineStyle"])).toHaveTextContent(
          en["properties.style.plain"]
        )
      );

      await selectRow(user, "Road");
      await waitFor(() =>
        expect(screen.getByLabelText(en["properties.lineStyle"])).toHaveTextContent(
          en["properties.style.road"]
        )
      );

      // Picking a style changes the selected line and takes its Encloses Fills default.
      await pickOption(user, en["properties.lineStyle"], en["properties.style.coast"]);
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).style).toBe("coast")
      );
      expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).enclosesFills).toBe(
        true
      );
      await waitFor(() =>
        expect(screen.getByLabelText(en["properties.lineStyle"])).toHaveTextContent(
          en["properties.style.coast"]
        )
      );

      // The switch turns Encloses Fills off again, by the keyboard.
      const encloses = screen.getByRole("switch", { name: en["properties.enclosesFills"] });
      expect(encloses).toBeChecked();
      await tabTo(user, encloses);
      expect(encloses).toHaveFocus();
      await user.keyboard(" ");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).enclosesFills).toBe(
          false
        )
      );
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0]).toMatchObject({
        style: "coast",
        enclosesFills: false,
      });

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("takes a Frame select for a known Element, clears on null, and drops the rest", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
      line("e2", "Line two", [
        [30, 30],
        [40, 40],
      ]),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      runtime.editor?.handleFrameMessage({ kind: "select", id: "e2" });
      expect(runtime.editor?.getSnapshot().selectedId).toBe("e2");

      runtime.editor?.handleFrameMessage({ kind: "select", id: null });
      expect(runtime.editor?.getSnapshot().selectedId).toBeNull();

      runtime.editor?.handleFrameMessage({ kind: "select", id: "e1" });
      expect(runtime.editor?.getSnapshot().selectedId).toBe("e1");

      // An id no Element has selects nothing, like an unknown pick.
      runtime.editor?.handleFrameMessage({ kind: "select", id: "missing" });
      expect(runtime.editor?.getSnapshot().selectedId).toBeNull();

      // A malformed select is dropped and leaves the selection alone.
      runtime.editor?.handleFrameMessage({ kind: "select", id: "e1" });
      runtime.editor?.handleFrameMessage({ kind: "select", id: 7 });
      runtime.editor?.handleFrameMessage({ kind: "select" });
      expect(runtime.editor?.getSnapshot().selectedId).toBe("e1");

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("Properties selects the row and moves focus to the Name field even when it is already selected", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await selectRow(user, "Line one");
      expect(runtime.editor?.getSnapshot().selectedId).toBe("e1");

      await chooseRowMenu(user, "Properties");

      await waitFor(() =>
        expect(screen.getByRole("textbox", { name: en["properties.name"] })).toHaveFocus()
      );
      expect(runtime.editor?.getSnapshot().selectedId).toBe("e1");

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("drops the selection when undo removes the selected Element", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      runtime.editor?.handleFrameMessage({
        kind: "stroke",
        points: [
          [10, 10],
          [20, 20],
        ],
      });
      expect(runtime.editor?.getSnapshot().selectedId).not.toBeNull();

      runtime.editor?.undo();
      const snapshot = runtime.editor?.getSnapshot();
      expect(snapshot?.elements).toHaveLength(0);
      expect(snapshot?.selectedId).toBeNull();
      // With nothing selected and a tool that offers no default, the Properties
      // card closes (#778), so none of its controls is left behind.
      expect(await screen.findByRole("button", { name: en["map.backToMaps"] })).toBeVisible();
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: en["chrome.minimiseProperties"] })
        ).not.toBeInTheDocument()
      );

      // Redo restores the Element, but a pruned selection stays cleared.
      runtime.editor?.redo();
      expect(runtime.editor?.getSnapshot().elements).toHaveLength(1);
      expect(runtime.editor?.getSnapshot().selectedId).toBeNull();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("keeps only the newest Frame port, so a remounted Frame stops receiving scenes", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
    ]);
    const { host, runtime, handoff } = frameHostFor(storage);
    try {
      expect(await runtime.openMap("m1")).toBe(true);

      const first = recordingPort();
      handoff("frame-1", first.port);
      const second = recordingPort();
      handoff("frame-2", second.port);

      // Each Frame gets one scene when it connects; only the newest is kept.
      expect(first.messages).toHaveLength(1);
      expect(second.messages).toHaveLength(1);

      runtime.editor?.select("e1");
      runtime.editor?.move(1, 0);

      expect(first.messages).toHaveLength(1);
      expect(second.messages.length).toBeGreaterThan(1);
    } finally {
      await host.stop();
    }
  });

  it("hands the Frame the installed PDF Font, so a pdf label draws in it", async () => {
    const bytes = new TextEncoder().encode("FONT BYTES");
    const { host, runtime, handoff } = frameHostFor(mapStorage([]), [
      { id: "latin", family: "Noto Serif", bytes },
    ]);
    try {
      expect(await runtime.openMap("m1")).toBe(true);
      const frame = recordingPort();
      handoff("frame-1", frame.port);

      const fonts = () => frame.messages.filter(isFontMessage);
      await waitFor(() => expect(fonts()).toHaveLength(1));
      expect(fonts()[0].family).toBe(MAP_LABEL_FONT_FAMILIES.pdf);
      expect(Array.from(new Uint8Array(fonts()[0].bytes))).toEqual(Array.from(bytes));
    } finally {
      await host.stop();
    }
  });

  it("sends no font when no PDF Font is installed, so a pdf label stays a serif", async () => {
    const { host, runtime, handoff } = frameHostFor(mapStorage([]));
    try {
      expect(await runtime.openMap("m1")).toBe(true);
      const frame = recordingPort();
      handoff("frame-1", frame.port);

      // The host answers this request only after the font read it served first,
      // so a font message would already be here.
      await expect(host.broker.request("health.check", null)).resolves.toBe("pong");
      expect(frame.messages.filter(isFontMessage)).toEqual([]);
      // The Frame still drew the scene it was handed.
      expect(frame.messages).toHaveLength(1);
    } finally {
      await host.stop();
    }
  });

  it("stays on the Map with a warning when Back to Maps cannot save, then leaves once it can", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
    ]);
    const setEntry = storage.set.bind(storage);
    let failSaves = false;
    storage.set = ((key: string, value: unknown) => {
      if (failSaves && key === mapKey("m1")) throw new Error("storage-full");
      return setEntry(key, value);
    }) as typeof storage.set;
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await selectRow(user, "Line one");
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: MOVE_RIGHT });
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).points[0][0]).toBe(11)
      );
      expect(linePoints(storage)[0][0]).toBe(10);

      failSaves = true;
      await focusPanelButton(user);
      await user.keyboard("{Enter}");

      // The write failed: the editor stays open and the page says so.
      await screen.findByText(en["map.saveFailed"]);
      expect(runtime.currentMapId).toBe("m1");
      expect(host.pageNavigations).not.toContainEqual({
        pluginId: "maibuk-maps",
        pageId: MAPS_PAGE_ID,
      });

      // The next Back retries the pending document and leaves once it lands.
      failSaves = false;
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(host.pageNavigations).toContainEqual({
          pluginId: "maibuk-maps",
          pageId: MAPS_PAGE_ID,
        })
      );
      expect(linePoints(storage)[0][0]).toBe(11);
      expect(runtime.currentMapId).toBeNull();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("flushes autosave before Back to Maps returns to the list", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await selectRow(user, "Line one");
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: MOVE_RIGHT });
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).points[0][0]).toBe(11)
      );
      expect(linePoints(storage)[0][0]).toBe(10);

      await focusPanelButton(user);
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(host.pageNavigations).toContainEqual({
          pluginId: "maibuk-maps",
          pageId: MAPS_PAGE_ID,
        })
      );
      await waitFor(() => expect(linePoints(storage)[0][0]).toBe(11));
      expect(runtime.currentMapId).toBeNull();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("backs out to the place a return target names, without opening the list", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
    ]);
    const { host } = await openEditor(storage);
    // The host replays its return target on subscription, so the page knows the
    // place that opened it without asking (#786).
    host.setReturnTarget("Plot");
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      const back = await screen.findByRole("button", {
        name: en["map.backTo"].replace("{label}", "Plot"),
      });
      await tabTo(user, back, 120);
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(host.returns).toEqual([{ pluginId: "maibuk-maps", status: "returned" }])
      );
      expect(host.pageNavigations).not.toContainEqual({
        pluginId: "maibuk-maps",
        pageId: MAPS_PAGE_ID,
      });
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("reads Back to Maps, and opens the list, when the page has no return target", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
    ]);
    const { host } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      const back = await screen.findByRole("button", { name: en["map.backToMaps"] });
      await tabTo(user, back, 120);
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(host.pageNavigations).toContainEqual({
          pluginId: "maibuk-maps",
          pageId: MAPS_PAGE_ID,
        })
      );
      expect(host.returns).toEqual([]);
      await page.unmount();
    } finally {
      await host.stop();
    }
  });
});
