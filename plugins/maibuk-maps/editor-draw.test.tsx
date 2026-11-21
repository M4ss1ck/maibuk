/**
 * The Map editor: opening a Map, the Elements list, Map Lines, Roughen, Fills, and the Bucket.
 * Every action is reached with `user-event` key presses and asserted by what
 * the host drew and stored; shared fixtures are in `test-support.tsx` (#850).
 */

import { type ReactElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";
import en from "./locales/runtime/en.json";
import {
  INDEX_KEY,
  type MapFillElement,
  type MapIndexEntry,
  type MapLineElement,
  type MapStampElement,
} from "./maps";
import { MAP_PAGE_ID, MAPS_PAGE_ID, MOVE_RIGHT } from "./runtime";
import { smoothStroke } from "./scene";
import { linePath, roughen, seedFor, shapeOutline } from "./geometry";
import {
  loadMapFrame,
  editorHostFor,
  line,
  mapStorage,
  storedMap,
  registerMapCommands,
  CommandKeys,
  openEditor,
  elementsList,
  selectRow,
  chooseRowMenu,
  focusPanelButton,
  linePoints,
  tabTo,
  pickTool,
  pickedTool,
  openLayers,
  placeShape,
} from "./test-support";

// A focused button opens its Tooltip, and Floating UI then reads computed
// style up the whole ancestor chain: in jsdom that was 38% of a keyboard
// test's time (#850). No test here asserts a Tooltip, so it renders its child.
vi.mock("@/components/ui/Tooltip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/Tooltip")>()),
  Tooltip: ({ children }: { children: ReactElement }) => children,
}));

describe("Map editor page", () => {
  it("opens a Map from the list by keyboard and draws its editor", async () => {
    const storage = mapStorage([
      line("e1", "Line one", [
        [10, 10],
        [20, 20],
      ]),
    ]);
    const { host, runtime } = editorHostFor(storage);
    try {
      const mapsPage = await host.renderPage(MAPS_PAGE_ID);
      const user = userEvent.setup({ delay: null });
      const open = await screen.findByRole("button", { name: /^Coast\b/ });
      await tabTo(user, open, 120);
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(host.pageNavigations).toContainEqual({
          pluginId: "maibuk-maps",
          pageId: MAP_PAGE_ID,
        })
      );
      expect(runtime.currentMapId).toBe("m1");
      await mapsPage.unmount();

      const editorPage = await host.renderPage(MAP_PAGE_ID);
      // The Map's own name is the top-left pill's second control (#778), and the
      // belt holds every tool: an IconButton each, the Pencil among them.
      await screen.findByRole("button", { name: "Coast" });
      expect(screen.getByRole("button", { name: en["tools.pencil"] })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: en["map.backToMaps"] })).toBeInTheDocument();
      // The Layers card starts shut (#778), so its Elements list is not drawn
      // until the author asks for it.
      expect(screen.queryByRole("list")).toBeNull();
      await openLayers(user);
      expect(elementsList()).toBeInTheDocument();
      await editorPage.unmount();
    } finally {
      await host.stop();
    }
  });

  it("shows an EmptyState when no Map is open, and returns to the list", async () => {
    const { host } = editorHostFor(new Map());
    try {
      const page = await host.renderPage(MAP_PAGE_ID);
      await screen.findByText(en["map.emptyTitle"]);
      const user = userEvent.setup({ delay: null });
      const back = screen.getByRole("button", { name: en["map.backToMaps"] });
      await tabTo(user, back, 120);
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(host.pageNavigations).toContainEqual({
          pluginId: "maibuk-maps",
          pageId: MAPS_PAGE_ID,
        })
      );
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("moves with ArrowRight and Shift+ArrowDown, then undoes and redoes", async () => {
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
      await selectRow(user, "Line one");
      await focusPanelButton(user);

      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).points[0][0]).toBe(11)
      );
      await runtime.editor?.flush();
      expect(linePoints(storage)[0][0]).toBe(11);

      await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).points[0][1]).toBe(20)
      );
      await runtime.editor?.flush();
      expect(linePoints(storage)[0][1]).toBe(20);

      await user.keyboard("{Control>}z{/Control}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).points[0][1]).toBe(10)
      );
      await runtime.editor?.flush();
      expect(linePoints(storage)[0]).toEqual([11, 10]);

      await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).points[0][1]).toBe(20)
      );
      await runtime.editor?.flush();
      expect(linePoints(storage)[0]).toEqual([11, 20]);

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("scales and turns the selected Stamp with the bracket, period, and comma keys, one undo step a press", async () => {
    const marker: MapStampElement = {
      id: "s1",
      kind: "stamp",
      name: "City",
      hidden: false,
      locked: false,
      stampRef: "base:marker",
      transform: { x: 100, y: 50, size: 12, rotation: 0 },
    };
    const storage = mapStorage([marker]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup({ delay: null });
      await selectRow(user, "City");
      await focusPanelButton(user);
      const transform = () =>
        (runtime.editor?.getSnapshot().elements[0] as MapStampElement).transform;

      // ] grows by ten percent and Shift+] by one; [ shrinks by ten percent.
      await user.keyboard("]");
      await waitFor(() => expect(transform().size).toBeCloseTo(13.2));
      await user.keyboard("{Shift>}{]}{/Shift}");
      await waitFor(() => expect(transform().size).toBeCloseTo(13.332));
      await user.keyboard("[[");
      await waitFor(() => expect(transform().size).toBeCloseTo(11.9988));

      // . turns fifteen degrees clockwise, Shift+. one, , fifteen back, Shift+, one back.
      await user.keyboard(".");
      await waitFor(() => expect(transform().rotation).toBe(15));
      await user.keyboard("{Shift>}{.}{/Shift}");
      await waitFor(() => expect(transform().rotation).toBe(16));
      await user.keyboard(",");
      await waitFor(() => expect(transform().rotation).toBe(1));
      await user.keyboard("{Shift>}{,}{/Shift}");
      await waitFor(() => expect(transform().rotation).toBe(0));

      // The centre never drifts, and the result is what the Map stores.
      expect(transform().x).toBe(100);
      expect(transform().y).toBe(50);
      await runtime.editor?.flush();
      const stored = (storedMap(storage).elements[0] as MapStampElement).transform;
      expect(stored).toMatchObject({ x: 100, y: 50, rotation: 0 });
      expect(stored.size).toBeCloseTo(11.9988);

      // Undo walks back one key press at a time.
      await user.keyboard("{Control>}z{/Control}");
      await waitFor(() => expect(transform().rotation).toBe(1));
      await user.keyboard("{Control>}z{/Control}");
      await waitFor(() => expect(transform().rotation).toBe(16));
      await user.keyboard("{Control>}z{/Control}");
      await waitFor(() => expect(transform().rotation).toBe(15));

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("leaves the Elements list's handled arrows to the list", async () => {
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
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup({ delay: null });
      await selectRow(user, "Line two");
      const list = elementsList();
      const first = within(list).getByRole("button", { name: /^Line one/ });

      // Tab walks the rows: focus moves, and the selected Map Line stays where
      // it was.
      await tabTo(user, first, 5);
      expect(document.activeElement).toBe(first);
      expect(runtime.editor?.getSnapshot().selectedId).toBe("e2");
      await runtime.editor?.flush();
      expect(linePoints(storage, 1)).toEqual([
        [30, 30],
        [40, 40],
      ]);

      // A vertical list does not handle the horizontal arrows, so those still
      // reach the Map Command and move the selected Element.
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[1] as MapLineElement).points[0][0]).toBe(31)
      );
      await runtime.editor?.flush();
      expect(linePoints(storage, 1)[0][0]).toBe(31);

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("renames, reorders, hides, locks, and deletes through the Elements list by keyboard", async () => {
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
      const user = userEvent.setup({ delay: null });

      await selectRow(user, "Line one");
      await chooseRowMenu(user, "Move up");
      await runtime.editor?.flush();
      expect(storedMap(storage).elements.map((element) => element.id)).toEqual(["e2", "e1"]);

      await selectRow(user, "Line one");
      await chooseRowMenu(user, "Move down");
      await runtime.editor?.flush();
      expect(storedMap(storage).elements.map((element) => element.id)).toEqual(["e1", "e2"]);

      await selectRow(user, "Line one");
      await chooseRowMenu(user, "Rename");
      const dialog = await screen.findByRole("dialog", { name: en["properties.renameTitle"] });
      const field = within(dialog).getByRole("textbox", { name: en["properties.name"] });
      expect(field).toHaveFocus();
      await user.keyboard("{Control>}a{/Control}Coastline");
      await tabTo(
        user,
        within(dialog).getByRole("button", { name: en["properties.renameSubmit"] }),
        10
      );
      await user.keyboard("{Enter}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0].name).toBe("Coastline");

      await selectRow(user, "Coastline");
      await chooseRowMenu(user, "Hide");
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0].hidden).toBe(true);

      await selectRow(user, "Coastline");
      await chooseRowMenu(user, "Lock");
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0].locked).toBe(true);

      const before = linePoints(storage)[0];
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: MOVE_RIGHT });
      expect(linePoints(storage)[0]).toEqual(before);

      await selectRow(user, "Coastline");
      await chooseRowMenu(user, "Delete");
      await runtime.editor?.flush();
      expect(storedMap(storage).elements.map((element) => element.id)).toEqual(["e2"]);
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: /^Coastline/ })).not.toBeInTheDocument()
      );

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("adds a smoothed Map Line from a Frame stroke and previews its path", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const raw: [number, number][] = [
        [10, 10],
        [10.02, 10.02],
        [30, 10],
        [40, 20],
      ];
      runtime.editor?.handleFrameMessage({ kind: "stroke", points: raw });
      await runtime.editor?.flush();

      const elements = storedMap(storage).elements;
      expect(elements).toHaveLength(1);
      const element = elements[0] as MapLineElement;
      expect(element).toMatchObject({
        kind: "line",
        name: "Map Line 1",
        hidden: false,
        locked: false,
        style: "plain",
        enclosesFills: true,
        closed: false,
        roughened: false,
      });
      expect(element.points).toEqual(smoothStroke(raw));
      expect(element.curves).toEqual(element.points.slice(1).map(() => true));
      expect(runtime.editor?.getSnapshot().selectedId).toBe(element.id);

      const preview = decodeURIComponent((storage.get(INDEX_KEY) as MapIndexEntry[])[0].preview);
      expect(preview).toContain(linePath(element));

      runtime.editor?.handleFrameMessage({ kind: "stroke", points: "not-points" });
      expect(runtime.editor?.getSnapshot().elements).toHaveLength(1);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("keeps a finished Pen line with its curves, closure, and current style", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      runtime.editor?.setLineStyle("coast");
      runtime.editor?.handleFrameMessage({
        kind: "line",
        points: [
          [10, 10],
          [20, 10],
          [20, 20],
        ],
        curves: [false, false, false],
        closed: true,
      });
      await runtime.editor?.flush();

      const elements = storedMap(storage).elements;
      expect(elements).toHaveLength(1);
      const element = elements[0] as MapLineElement;
      expect(element).toMatchObject({
        kind: "line",
        name: "Map Line 1",
        hidden: false,
        locked: false,
        style: "coast",
        enclosesFills: true,
        closed: true,
        roughened: false,
      });
      expect(element.curves).toEqual([false, false, false]);
      expect(runtime.editor?.getSnapshot().selectedId).toBe(element.id);

      // A malformed line is dropped and changes nothing.
      runtime.editor?.handleFrameMessage({
        kind: "line",
        points: [
          [0, 0],
          [1, 1],
        ],
        curves: [],
        closed: false,
      });
      runtime.editor?.handleFrameMessage({ kind: "line", points: [[0, 0]], curves: [] });
      expect(runtime.editor?.getSnapshot().elements).toHaveLength(1);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("splits a Map Line with one Eraser drag as a single undo step", async () => {
    const storage = mapStorage([
      line(
        "e1",
        "Coastline",
        [
          [0, 0],
          [10, 0],
          [20, 0],
          [30, 0],
        ],
        { curves: [false, false, false] }
      ),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const before = runtime.editor?.getSnapshot().elements;

      runtime.editor?.handleFrameMessage({
        kind: "erase",
        points: [
          [15, 5],
          [15, -5],
        ],
        radiusMm: 2,
      });
      await runtime.editor?.flush();

      const pieces = storedMap(storage).elements as MapLineElement[];
      expect(pieces).toHaveLength(2);
      // The first piece keeps the id and name; the second takes a new id and
      // the name plus its number, right after the original in z-order.
      expect(pieces[0].id).toBe("e1");
      expect(pieces[0].name).toBe("Coastline");
      expect(pieces[1].id).not.toBe("e1");
      expect(pieces[1].name).toBe("Coastline 2");
      expect(pieces[0].closed).toBe(false);
      expect(pieces[1].closed).toBe(false);
      expect(pieces[0].points[pieces[0].points.length - 1][0]).toBeCloseTo(13, 0);
      expect(pieces[1].points[0][0]).toBeCloseTo(17, 0);

      runtime.editor?.undo();
      const restored = runtime.editor?.getSnapshot().elements;
      expect(restored).toEqual(before);
      expect(restored).toHaveLength(1);

      // An erase that touches nothing, or a malformed one, is not an edit.
      runtime.editor?.handleFrameMessage({
        kind: "erase",
        points: [[60, 60]],
        radiusMm: 2,
      });
      runtime.editor?.handleFrameMessage({ kind: "erase", points: [], radiusMm: 2 });
      expect(runtime.editor?.getSnapshot().elements).toHaveLength(1);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("tells the Frame both plural forms of the Pen draft label, in the app language", async () => {
    const { host, runtime } = await openEditor(mapStorage([]), "es");
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      // The Frame counts its own draft but cannot read the catalogs, so both
      // forms ship with the scene: "1 punto", "2 puntos".
      const sent: Array<Record<string, unknown>> = [];
      const port = {
        postMessage: (message: Record<string, unknown>) => sent.push(message),
      } as unknown as MessagePort;
      runtime.editor?.attachFrame(port);
      expect(sent.at(-1)?.penLabel).toEqual({
        one: "Línea de pluma, {{count}} punto",
        other: "Línea de pluma, {{count}} puntos",
      });

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("changes the selected line's style, resets Encloses Fills, and undoes in one step", async () => {
    const storage = mapStorage([
      line(
        "e1",
        "River",
        [
          [0, 0],
          [10, 10],
        ],
        { style: "river", enclosesFills: false }
      ),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      runtime.editor?.select("e1");
      expect(runtime.editor?.getSnapshot().selectedIsLine).toBe(true);
      expect(runtime.editor?.getSnapshot().selectedLineStyle).toBe("river");
      expect(runtime.editor?.getSnapshot().selectedEnclosesFills).toBe(false);
      expect(runtime.editor?.getSnapshot().currentLineStyle).toBe("plain");

      runtime.editor?.setLineStyle("coast");
      const changed = runtime.editor?.getSnapshot().elements[0] as MapLineElement;
      expect(changed.style).toBe("coast");
      expect(changed.enclosesFills).toBe(true);
      expect(runtime.editor?.getSnapshot().currentLineStyle).toBe("coast");
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapLineElement).style).toBe("coast");

      runtime.editor?.undo();
      const restored = runtime.editor?.getSnapshot().elements[0] as MapLineElement;
      expect(restored.style).toBe("river");
      expect(restored.enclosesFills).toBe(false);

      // With no Map Line selected, the pick only becomes the current style.
      runtime.editor?.select(null);
      expect(runtime.editor?.getSnapshot().selectedIsLine).toBe(false);
      expect(runtime.editor?.getSnapshot().selectedLineStyle).toBeNull();
      runtime.editor?.setLineStyle("road");
      expect(runtime.editor?.getSnapshot().currentLineStyle).toBe("road");
      expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).style).toBe("river");

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("sets Encloses Fills on one line as its own undo step", async () => {
    const storage = mapStorage([
      line(
        "e1",
        "Coast",
        [
          [0, 0],
          [10, 10],
        ],
        { style: "coast", enclosesFills: true }
      ),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      runtime.editor?.setEnclosesFills("e1", false);
      expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).enclosesFills).toBe(
        false
      );
      runtime.editor?.undo();
      expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).enclosesFills).toBe(
        true
      );
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("changes neither style nor Encloses Fills of a locked line", async () => {
    const storage = mapStorage([
      line(
        "e1",
        "Coast",
        [
          [0, 0],
          [10, 10],
        ],
        { style: "coast", enclosesFills: true, locked: true }
      ),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      runtime.editor?.select("e1");
      // Roughen and drag already refuse a locked Element; so do these two, and
      // a refused edit is not an undo step.
      runtime.editor?.setLineStyle("road");
      runtime.editor?.setEnclosesFills("e1", false);
      const locked = runtime.editor?.getSnapshot().elements[0] as MapLineElement;
      expect(locked.style).toBe("coast");
      expect(locked.enclosesFills).toBe(true);
      expect(runtime.editor?.getSnapshot().currentLineStyle).toBe("plain");
      expect(runtime.editor?.getSnapshot().canUndo).toBe(false);
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapLineElement).style).toBe("coast");

      // Unlocking lets the same pick through, as one undo step.
      runtime.editor?.setLocked("e1", false);
      runtime.editor?.setLineStyle("road");
      const unlocked = runtime.editor?.getSnapshot().elements[0] as MapLineElement;
      expect(unlocked.style).toBe("road");
      expect(unlocked.enclosesFills).toBe(false);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("roughens the selected line as one undo step, and undo restores its exact points", async () => {
    const points: [number, number][] = [
      [0, 0],
      [30, 0],
      [30, 30],
    ];
    const storage = mapStorage([line("e1", "Coast", points, { curves: [false, false] })]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      runtime.editor?.select("e1");
      runtime.editor?.setRoughenStrength(3);
      expect(runtime.editor?.getSnapshot().roughenStrength).toBe(3);
      // The slider's own range clamps a value from outside it.
      runtime.editor?.setRoughenStrength(10);
      expect(runtime.editor?.getSnapshot().roughenStrength).toBe(5);
      runtime.editor?.setRoughenStrength(3);

      runtime.editor?.roughen();
      const roughened = runtime.editor?.getSnapshot().elements[0] as MapLineElement;
      expect(roughened.roughened).toBe(true);
      expect(roughened.points.length).toBeGreaterThan(points.length);
      expect(roughened.curves).toHaveLength(roughened.points.length - 1);
      expect(roughened.curves.every((flag) => flag === false)).toBe(true);
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapLineElement).roughened).toBe(true);

      runtime.editor?.undo();
      const restored = runtime.editor?.getSnapshot().elements[0] as MapLineElement;
      expect(restored.points).toEqual(points);
      expect(restored.roughened).toBe(false);

      // No selected line is a no-op.
      runtime.editor?.select(null);
      runtime.editor?.roughen();
      expect(runtime.editor?.getSnapshot().elements).toHaveLength(1);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("raises the Roughen strength with ArrowRight and Roughens the line with it", async () => {
    const points: [number, number][] = [
      [0, 0],
      [30, 0],
      [30, 30],
    ];
    const storage = mapStorage([line("e1", "Coast", points, { curves: [false, false] })]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await selectRow(user, "Coast");
      expect(runtime.editor?.getSnapshot().roughenStrength).toBe(1.5);

      const slider = screen.getByRole("slider", { name: en["properties.roughenStrength"] });
      await tabTo(user, slider, 120);
      await user.keyboard("{ArrowRight}");
      await waitFor(() => expect(runtime.editor?.getSnapshot().roughenStrength).toBeCloseTo(1.6));
      const raised = runtime.editor?.getSnapshot().roughenStrength ?? 0;
      expect(raised).toBeGreaterThan(1.5);

      const roughenButton = await screen.findByRole("button", {
        name: en["properties.roughen"],
      });
      await tabTo(user, roughenButton, 120);
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).roughened).toBe(true)
      );
      await runtime.editor?.flush();

      // The path is the one Roughen draws at the strength the author picked.
      const stored = storedMap(storage).elements[0] as MapLineElement;
      expect(stored.points).toEqual(roughen(points, false, raised, seedFor("e1")));

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("selects the Pen by its key, Roughens by its Shortcut, and undo restores the exact points", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup({ delay: null });
      // The page commits after `renderPage` returns; wait for its first control.
      await screen.findByRole("button", { name: en["tools.pen"] });
      await focusPanelButton(user);

      // The Pen tool's own key selects it, and the belt follows.
      await user.keyboard("n");
      await waitFor(() => expect(runtime.editor?.getSnapshot().tool).toBe("pen"));
      await waitFor(() =>
        expect(pickedTool(en["tools.pen"])).toHaveAttribute("aria-pressed", "true")
      );

      // The keyboard pen draws a closed outline in the Frame; the Frame stand-in
      // hands the editor the line message the real Frame posts for it.
      const outline: [number, number][] = [
        [20, 20],
        [60, 20],
        [60, 50],
        [20, 50],
      ];
      runtime.editor?.handleFrameMessage({
        kind: "line",
        points: outline,
        curves: [false, false, false, false],
        closed: true,
      });
      await runtime.editor?.flush();

      const drawn = storedMap(storage).elements[0] as MapLineElement;
      expect(drawn).toMatchObject({ style: "plain", closed: true, roughened: false });
      expect(drawn.points).toEqual(outline);
      expect(runtime.editor?.getSnapshot().selectedId).toBe(drawn.id);

      // Roughen by its Shortcut resamples the line off its path, as one step.
      await user.keyboard("{Control>}{Shift>}r{/Shift}{/Control}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).roughened).toBe(true)
      );
      const roughened = runtime.editor?.getSnapshot().elements[0] as MapLineElement;
      expect(roughened.points.length).toBeGreaterThan(outline.length);
      expect(roughened.points).not.toEqual(outline);
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapLineElement).roughened).toBe(true);

      // Undo puts the exact points back.
      await user.keyboard("{Control>}z{/Control}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).roughened).toBe(false)
      );
      expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).points).toEqual(outline);
      await runtime.editor?.flush();
      expect(linePoints(storage)).toEqual(outline);

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("draws an Area Fill with the keyboard and Roughens its outline", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    registerMapCommands();
    // The real Frame runs here, so the arrows move its crosshair and Enter
    // posts the outline it closes; nothing about the Frame is stubbed.
    const workerPort = loadMapFrame(runtime);
    runtime.editor?.attachFrame(workerPort);
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup({ delay: null });

      // The Area tool's own key selects it, through the host's shortcut registry.
      await user.keyboard("a");
      await waitFor(() => expect(runtime.editor?.getSnapshot().tool).toBe("area"));

      // The crosshair starts at the view centre of the portrait page, 76.2 by
      // 114.3 mm; Shift+Arrow steps it ten millimetres.
      const startX = 152.4 / 2;
      const startY = 228.6 / 2;
      await user.keyboard("{Enter}");
      await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
      await user.keyboard("{Enter}");
      await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
      await user.keyboard("{Enter}");
      // Back on the first point, Enter closes the outline.
      await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
      await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
      await user.keyboard("{Enter}");

      await waitFor(() => expect(runtime.editor?.getSnapshot().elements).toHaveLength(1));
      await runtime.editor?.flush();

      // The outline the author pointed out is the Area Fill the Map keeps.
      const drawn = storedMap(storage).elements[0] as MapFillElement;
      expect(drawn).toMatchObject({
        kind: "fill",
        name: "Fill 1",
        content: { color: "land" },
      });
      expect(drawn.outline?.points).toEqual([
        [startX, startY],
        [startX + 10, startY],
        [startX + 10, startY + 10],
      ]);
      expect(drawn.outline?.curves).toEqual([false, false, false]);
      expect(drawn.outline?.roughened).toBe(false);
      expect(runtime.editor?.getSnapshot().selectedId).toBe(drawn.id);

      // Roughen by its Shortcut redraws that outline, as one undo step.
      await user.keyboard("{Control>}{Shift>}r{/Shift}{/Control}");
      const roughenedNow = () =>
        (runtime.editor?.getSnapshot().elements[0] as MapFillElement).outline?.roughened;
      await waitFor(() => expect(roughenedNow()).toBe(true));
      const roughened = runtime.editor?.getSnapshot().elements[0] as MapFillElement;
      expect(roughened.outline?.points.length).toBeGreaterThan(drawn.outline?.points.length ?? 0);
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapFillElement).outline?.roughened).toBe(true);
    } finally {
      keys.unmount();
      await host.stop();
    }
  });

  it("picks the Bucket, pours at the keyboard crosshair, and undoes the Fill", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup({ delay: null });

      // A closed Shape to pour into, landed at the view centre by keyboard.
      await placeShape(user, "rectangle");
      await waitFor(() => expect(runtime.editor?.getSnapshot().elements).toHaveLength(1));

      // The belt reaches the Bucket by keyboard like any other button.
      await pickTool(user, en["tools.bucket"]);
      expect(runtime.editor?.getSnapshot().tool).toBe("bucket");

      // Enter at the crosshair sends the Frame's pour message; the Frame stand-in
      // hands the editor the point the real Frame would report (the page centre).
      runtime.editor?.handleFrameMessage({ kind: "pour", point: [76.2, 114.3] });
      await runtime.editor?.flush();

      await openLayers(user);
      const list = await screen.findByRole("list");
      await within(list).findByRole("button", { name: /^Fill 1/ });
      const poured = storedMap(storage).elements.find(
        (element): element is MapFillElement => element.kind === "fill"
      );
      expect(poured).toMatchObject({ name: "Fill 1", content: { color: "land" } });
      expect(runtime.editor?.getSnapshot().selectedId).toBe(poured?.id);
      expect(elementsList()).toHaveTextContent(en["element.kind.fill"]);

      // Undo by its Shortcut takes the Fill off the list again.
      await focusPanelButton(user);
      await user.keyboard("{Control>}z{/Control}");
      await waitFor(() =>
        expect(within(list).queryByRole("button", { name: /^Fill/ })).not.toBeInTheDocument()
      );
      await runtime.editor?.flush();
      expect(storedMap(storage).elements.some((element) => element.kind === "fill")).toBe(false);

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("sets the Bucket's Fill color, then a selected Fill's, from the properties panel", async () => {
    const storage = mapStorage([
      line(
        "ring",
        "Ring",
        [
          [10, 10],
          [90, 10],
          [90, 90],
          [10, 90],
        ],
        { closed: true, curves: [false, false, false, false] }
      ),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup({ delay: null });

      /** Opens the Fill color picker and commits one hex colour by keyboard. */
      async function pickColor(hex: string): Promise<void> {
        const trigger = await screen.findByRole("button", { name: en["properties.fillColor"] });
        await tabTo(user, trigger, 120);
        await user.keyboard("{Enter}");
        const dialog = await screen.findByRole("dialog", { name: en["properties.fillColor"] });
        const field = within(dialog).getByRole("textbox");
        await user.clear(field);
        await user.type(field, hex);
        await user.keyboard("{Enter}");
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      }

      // With the Bucket active the control holds what the next pour uses.
      await pickTool(user, en["tools.bucket"]);
      await pickColor("#112233");
      await waitFor(() => expect(runtime.editor?.getSnapshot().currentFillColor).toBe("#112233"));

      runtime.editor?.handleFrameMessage({ kind: "pour", point: [50, 50] });
      await runtime.editor?.flush();
      const poured = storedMap(storage).elements.find(
        (element): element is MapFillElement => element.kind === "fill"
      );
      expect(poured?.content.color).toBe("#112233");

      // With a Fill selected the same control edits that Fill.
      await user.keyboard("v");
      await waitFor(() => expect(runtime.editor?.getSnapshot().tool).toBe("select"));
      expect(runtime.editor?.getSnapshot().selectedId).toBe(poured?.id);

      const trigger = await screen.findByRole("button", { name: en["properties.fillColor"] });
      await tabTo(user, trigger, 120);
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog", { name: en["properties.fillColor"] });
      expect(within(dialog).getByRole("textbox")).toHaveValue("#112233");
      await user.clear(within(dialog).getByRole("textbox"));
      await user.type(within(dialog).getByRole("textbox"), "#445566");
      await user.keyboard("{Enter}");
      await user.keyboard("{Escape}");

      await waitFor(() => expect(runtime.editor?.getSnapshot().selectedFillColor).toBe("#445566"));
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapFillElement).content.color).toBe("#445566");

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("places an ellipse by keyboard and makes it a circle through Width and Height", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await placeShape(user, "ellipse");
      expect(runtime.editor?.getSnapshot().elements).toHaveLength(1);

      // The Frame's drag is the pointer path; the number fields are the keyboard's.
      const width = await screen.findByRole("textbox", { name: en["properties.shape.width"] });
      await tabTo(user, width, 120);
      await user.keyboard("{Control>}a{/Control}60{Tab}");
      const height = screen.getByRole("textbox", { name: en["properties.shape.height"] });
      await tabTo(user, height, 120);
      await user.keyboard("{Control>}a{/Control}60{Tab}");

      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLineElement).shape).toMatchObject({
          kind: "ellipse",
          width: 60,
          height: 60,
        })
      );
      await runtime.editor?.flush();

      const stored = storedMap(storage).elements[0] as MapLineElement;
      expect(stored.shape).toEqual({
        kind: "ellipse",
        cx: 76.2,
        cy: 114.3,
        width: 60,
        height: 60,
        rotation: 0,
        sides: 6,
        cornerRadius: 0,
      });
      if (stored.shape === undefined) throw new Error("the line kept no Shape");
      expect(stored.points).toEqual(shapeOutline(stored.shape).points);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });
});
