import { type ReactElement } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type CommandId } from "@/lib/shortcut-registry";
import { effectiveShortcuts } from "@/lib/shortcut-resolve";
import { PLUGIN_UI_LIMITS, createPluginClient } from "@/plugin-sdk";
import {
  PLUGIN_CANVAS_REFERENCE_LIST_REQUEST,
  PLUGIN_CANVAS_REFERENCE_OPEN_REQUEST,
  PLUGIN_CANVAS_REFERENCE_RESOLVE_REQUEST,
  PLUGIN_COMMAND_RUN_REQUEST,
  PLUGIN_MIGRATE_DATA_REQUEST,
} from "@/plugin-sdk/protocol";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import {
  ALT_TEXT_MAX_CHARS,
  exportLogLine,
  INSERT_IMAGE_CAP_BYTES,
  placePixelSize,
} from "./export";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";
import {
  INDEX_KEY,
  PAGE_SIZES,
  createMapStore,
  mapKey,
  type MapDocument,
  type MapIndexEntry,
  type MapLabelElement,
} from "./maps";
import {
  BOOK_MAPS,
  MAP_PAGE_ID,
  MAPS_PAGE_ID,
  NEXT_MAP_STYLE,
  OPEN_MAPS,
  startMaps,
} from "./runtime";
import { templateElements } from "./templates";
import {
  createTestHost,
  mapsManifest,
  BOOKS,
  seededStorage,
  hostFor,
  frameStandIn,
  PLACE_CHAPTERS,
  placeHostFor,
  mapStorage,
  registerMapCommands,
  openEditor,
  tabTo,
  pickOption,
  names,
  index,
} from "./test-support";

// A focused button opens its Tooltip, and Floating UI then reads computed
// style up the whole ancestor chain: in jsdom that was 38% of a keyboard
// test's time (#850). No test here asserts a Tooltip, so it renders its child.
vi.mock("@/components/ui/Tooltip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/Tooltip")>()),
  Tooltip: ({ children }: { children: ReactElement }) => children,
}));

describe("Maps page", () => {
  it("creates a Map by keyboard alone: name, Book, and page size", async () => {
    const storage = new Map<string, unknown>();
    const host = hostFor(storage);
    try {
      const page = await host.renderPage(MAPS_PAGE_ID);
      expect(await screen.findByText(en["list.emptyTitle"])).toBeInTheDocument();
      const user = userEvent.setup({ delay: null });

      const create = screen.getByRole("button", { name: en["list.new"] });
      await tabTo(user, create);
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog", { name: en["create.title"] });
      expect(within(dialog).getByRole("textbox", { name: en["create.name"] })).toHaveFocus();
      await user.keyboard("Northern Reach");

      await pickOption(user, en["create.book"], "The Salt Road", dialog);
      const landscape = within(dialog).getByRole("radio", { name: en["page.landscape"] });
      await tabTo(user, landscape);
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect(within(dialog).getByRole("radio", { name: en["page.spread"] })).toBeChecked()
      );

      await tabTo(user, within(dialog).getByRole("button", { name: en["create.submit"] }));
      await user.keyboard("{Enter}");

      await waitFor(() => expect(names()).toEqual(["Northern Reach"]));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByText(`The Salt Road · ${en["page.spread"]}`)).toBeInTheDocument();
      const [created] = index(storage);
      expect(created).toMatchObject({ name: "Northern Reach", bookId: "b2", preset: "spread" });
      expect(storage.get(mapKey(created.id))).toMatchObject({ elements: [], dataVersion: 1 });
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("creates a Map from a Template by keyboard alone", async () => {
    const storage = new Map<string, unknown>();
    const host = hostFor(storage);
    try {
      const page = await host.renderPage(MAPS_PAGE_ID);
      expect(await screen.findByText(en["list.emptyTitle"])).toBeInTheDocument();
      const user = userEvent.setup({ delay: null });

      const create = screen.getByRole("button", { name: en["list.new"] });
      await tabTo(user, create);
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog", { name: en["create.title"] });
      expect(within(dialog).getByRole("textbox", { name: en["create.name"] })).toHaveFocus();
      await user.keyboard("Archipelago Reach");

      const startFrom = within(dialog).getByRole("radiogroup", { name: en["create.template"] });
      const blank = within(startFrom).getByRole("radio", { name: en["template.blank"] });
      await tabTo(user, blank);
      // Blank, then the first Template, then Archipelago.
      await user.keyboard("{ArrowDown}");
      await user.keyboard("{ArrowDown}");
      await waitFor(() =>
        expect(
          within(startFrom).getByRole("radio", { name: en["template.archipelago"] })
        ).toBeChecked()
      );

      await tabTo(user, within(dialog).getByRole("button", { name: en["create.submit"] }));
      await user.keyboard("{Enter}");
      await waitFor(() => expect(names()).toEqual(["Archipelago Reach"]));

      const [templated] = index(storage);
      const doc = storage.get(mapKey(templated.id)) as MapDocument;
      expect(doc.styleId).toBe("parchment");
      expect(doc.elements.map(({ id: _id, ...rest }) => rest)).toEqual(
        templateElements("archipelago", PAGE_SIZES.landscape, "Archipelago Reach", () => "x").map(
          ({ id: _id, ...rest }) => rest
        )
      );
      expect(doc.elements.filter((element) => element.kind === "fill")).toHaveLength(7);
      const compass = doc.elements.find(
        (element) => element.kind === "stamp" && element.stampRef === "base:compass-rose"
      );
      expect(compass).toBeDefined();
      const label = doc.elements.find(
        (element): element is MapLabelElement => element.kind === "label"
      );
      expect(label?.text).toBe("Archipelago Reach");

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("starts a new Map from Blank by default", async () => {
    const storage = new Map<string, unknown>();
    const host = hostFor(storage);
    try {
      const page = await host.renderPage(MAPS_PAGE_ID);
      expect(await screen.findByText(en["list.emptyTitle"])).toBeInTheDocument();
      const user = userEvent.setup({ delay: null });

      const create = screen.getByRole("button", { name: en["list.new"] });
      await tabTo(user, create);
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog", { name: en["create.title"] });
      const startFrom = within(dialog).getByRole("radiogroup", { name: en["create.template"] });
      expect(within(startFrom).getByRole("radio", { name: en["template.blank"] })).toBeChecked();

      await user.keyboard("Plain Coast");
      await tabTo(user, within(dialog).getByRole("button", { name: en["create.submit"] }));
      await user.keyboard("{Enter}");
      await waitFor(() => expect(names()).toEqual(["Plain Coast"]));

      const [blankMap] = index(storage);
      expect(storage.get(mapKey(blankMap.id))).toMatchObject({ styleId: "atlas", elements: [] });
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("offers the Templates in the author's language", async () => {
    const host = hostFor(new Map<string, unknown>(), "es");
    try {
      const page = await host.renderPage(MAPS_PAGE_ID);
      const user = userEvent.setup({ delay: null });
      const create = await screen.findByRole("button", { name: es["list.new"] });
      await tabTo(user, create);
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog", { name: es["create.title"] });
      const startFrom = within(dialog).getByRole("radiogroup", { name: es["create.template"] });
      // Blank first, then each Template in the picker's order, every label Spanish.
      const blank = within(startFrom).getByRole("radio", { name: es["template.blank"] });
      await tabTo(user, blank);
      for (const label of [
        es["template.continent"],
        es["template.archipelago"],
        es["template.two-continents"],
        es["template.inland-kingdom"],
        es["template.blank-sea"],
        es["template.cuba"],
      ]) {
        await user.keyboard("{ArrowDown}");
        await waitFor(() =>
          expect(within(startFrom).getByRole("radio", { name: label })).toBeChecked()
        );
      }
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("keeps the dialog open with an error when the name is empty, and Escape closes it", async () => {
    const storage = new Map<string, unknown>();
    const host = hostFor(storage);
    try {
      const page = await host.renderPage(MAPS_PAGE_ID);
      const user = userEvent.setup({ delay: null });
      const create = await screen.findByRole("button", { name: en["list.new"] });
      await tabTo(user, create);
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog");
      await tabTo(user, within(dialog).getByRole("button", { name: en["create.submit"] }));
      await user.keyboard("{Enter}");
      expect(await within(dialog).findByText(en["dialog.emptyName"])).toBeInTheDocument();
      expect(storage.has(INDEX_KEY)).toBe(false);

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() =>
        expect(screen.getByRole("button", { name: en["list.new"] })).toHaveFocus()
      );
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("renames a Map by keyboard, and the index follows", async () => {
    const storage = seededStorage();
    const host = hostFor(storage);
    try {
      const page = await host.renderPage(MAPS_PAGE_ID);
      const user = userEvent.setup({ delay: null });
      const rename = await screen.findByRole("button", { name: `${en["list.rename"]} Isles` });
      await tabTo(user, rename);
      await user.keyboard("{Enter}");
      await screen.findByRole("dialog", { name: en["rename.title"] });
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(rename).toHaveFocus());
      expect(index(storage).find((row) => row.id === "m2")?.name).toBe("Isles");

      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog", { name: en["rename.title"] });
      const field = within(dialog).getByRole("textbox", { name: en["create.name"] });
      expect(field).toHaveValue("Isles");
      await user.keyboard("{Control>}a{/Control}Shattered Isles");
      await tabTo(user, within(dialog).getByRole("button", { name: en["rename.submit"] }));
      await user.keyboard("{Enter}");

      await waitFor(() => expect(names()).toEqual(["Shattered Isles", "Coast", "Loose"]));
      expect(index(storage).find((row) => row.id === "m2")?.name).toBe("Shattered Isles");
      expect(storage.get(mapKey("m2"))).toMatchObject({ name: "Shattered Isles" });
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("deletes a Map by keyboard after confirming", async () => {
    const storage = seededStorage();
    const host = hostFor(storage);
    try {
      const page = await host.renderPage(MAPS_PAGE_ID);
      const user = userEvent.setup({ delay: null });
      const remove = await screen.findByRole("button", { name: `${en["list.delete"]} Coast` });
      await tabTo(user, remove);
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByText("Delete Coast?")).toBeInTheDocument();

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      await waitFor(() => expect(remove).toHaveFocus());
      expect(names()).toEqual(["Coast", "Isles", "Loose"]);

      await tabTo(user, screen.getByRole("button", { name: `${en["list.delete"]} Coast` }));
      await user.keyboard("{Enter}");
      const again = await screen.findByRole("alertdialog");
      await tabTo(user, within(again).getByRole("button", { name: en["delete.confirm"] }));
      await user.keyboard("{Enter}");

      await waitFor(() => expect(names()).toEqual(["Isles", "Loose"]));
      expect(storage.has(mapKey("m1"))).toBe(false);
      expect(index(storage).map((row) => row.id)).toEqual(["m2", "m3"]);
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("filters by Book; a Map with no Book shows only under All", async () => {
    const host = hostFor(seededStorage());
    try {
      const page = await host.renderPage(MAPS_PAGE_ID);
      await waitFor(() => expect(names()).toEqual(["Coast", "Isles", "Loose"]));
      const user = userEvent.setup({ delay: null });
      await pickOption(user, en["list.filter"], "Tides of Ash");
      await waitFor(() => expect(names()).toEqual(["Coast", "Isles"]));
      await pickOption(user, en["list.filter"], "The Salt Road");
      expect(await screen.findByText(en["list.emptyBookTitle"])).toBeInTheDocument();
      await pickOption(user, en["list.filter"], en["list.filter.all"]);
      await waitFor(() => expect(names()).toEqual(["Coast", "Isles", "Loose"]));
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("speaks Spanish when the app does", async () => {
    const host = hostFor(new Map(), "es");
    try {
      const page = await host.renderPage(MAPS_PAGE_ID);
      expect(await screen.findByText(es["list.emptyTitle"])).toBeInTheDocument();
      expect(screen.getByRole("button", { name: es["list.new"] })).toBeInTheDocument();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });
});

describe("Maps Commands and host requests", () => {
  it("Open Maps opens the page", async () => {
    const host = hostFor();
    try {
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: OPEN_MAPS });
      expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-maps", pageId: MAPS_PAGE_ID }]);
    } finally {
      await host.stop();
    }
  });

  it("Next Map Style cycles every Style, each switch one undo step", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    try {
      expect(runtime.editor?.getSnapshot().styleId).toBe("atlas");
      for (const style of ["parchment", "ink", "night", "atlas"] as const) {
        await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: NEXT_MAP_STYLE });
        expect(runtime.editor?.getSnapshot().styleId).toBe(style);
      }

      // Each switch is one history step, so undo walks back through them.
      runtime.editor?.undo();
      expect(runtime.editor?.getSnapshot().styleId).toBe("night");
      runtime.editor?.undo();
      expect(runtime.editor?.getSnapshot().styleId).toBe("ink");
    } finally {
      await host.stop();
    }
  });

  it("the Book Item Menu entry opens the page filtered to that Book", async () => {
    const host = hostFor(seededStorage());
    try {
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, {
        id: BOOK_MAPS,
        target: { kind: "book", id: "b1" },
      });
      expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-maps", pageId: MAPS_PAGE_ID }]);
      const page = await host.renderPage(MAPS_PAGE_ID);
      await waitFor(() => expect(names()).toEqual(["Coast", "Isles"]));
      expect(screen.getByLabelText(en["list.filter"])).toHaveTextContent("Tides of Ash");
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("the next visit after a Book's entry starts at All again", async () => {
    const host = hostFor(seededStorage());
    try {
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, {
        id: BOOK_MAPS,
        target: { kind: "book", id: "b1" },
      });
      const first = await host.renderPage(MAPS_PAGE_ID);
      await waitFor(() => expect(names()).toEqual(["Coast", "Isles"]));
      await first.unmount();

      const second = await host.renderPage(MAPS_PAGE_ID);
      await waitFor(() => expect(names()).toEqual(["Coast", "Isles", "Loose"]));
      await second.unmount();
    } finally {
      await host.stop();
    }
  });

  it("keeps a Book's filter when the Library read fails, rather than showing every Map", async () => {
    const host = createTestHost({
      manifest: mapsManifest(),
      library: { books: BOOKS },
      storage: seededStorage(),
      permissions: ["editor:write", "files:pick", "files:save"],
    });
    startMaps(createPluginClient(host.port), servePluginUi);
    try {
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, {
        id: BOOK_MAPS,
        target: { kind: "book", id: "b1" },
      });
      const page = await host.renderPage(MAPS_PAGE_ID);
      await waitFor(() => expect(names()).toEqual(["Coast", "Isles"]));
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("answers migrateData from version 1 without touching the data", async () => {
    const storage = seededStorage();
    const before = structuredClone([...storage]);
    const host = hostFor(storage);
    try {
      await expect(
        host.broker.request(PLUGIN_MIGRATE_DATA_REQUEST, { from: 1 })
      ).resolves.toBeNull();
      expect([...storage]).toEqual(before);
    } finally {
      await host.stop();
    }
  });
});

describe("Maps Canvas Reference source", () => {
  /** Deletes a Map through the same store the Plugin writes with. */
  async function removeStoredMap(storage: Map<string, unknown>, id: string): Promise<void> {
    await createMapStore({
      get: async ({ key }) => storage.get(key),
      set: async ({ key, value }) => {
        storage.set(key, value);
        return null;
      },
      delete: async ({ key }) => {
        storage.delete(key);
        return null;
      },
    }).remove(id);
  }

  it("lists every Map, subtitled by its Book's title", async () => {
    const host = hostFor(seededStorage());
    try {
      const result = await host.broker.request(PLUGIN_CANVAS_REFERENCE_LIST_REQUEST, {
        source: "maps",
        query: "",
      });
      expect(result).toEqual({
        rows: [
          { id: "m1", title: "Coast", subtitle: "Tides of Ash" },
          { id: "m2", title: "Isles", subtitle: "Tides of Ash" },
          { id: "m3", title: "Loose" },
        ],
      });
      // The rows stay text only: the picture rides on a resolve answer (#847).
      const { rows } = result as { rows: Array<Record<string, unknown>> };
      expect(rows.some((row) => "image" in row)).toBe(false);
    } finally {
      await host.stop();
    }
  });

  it("filters rows by name, trimmed and case-insensitive", async () => {
    const host = hostFor(seededStorage());
    try {
      const result = await host.broker.request(PLUGIN_CANVAS_REFERENCE_LIST_REQUEST, {
        source: "maps",
        query: "  isLe ",
      });
      expect(result).toEqual({ rows: [{ id: "m2", title: "Isles", subtitle: "Tides of Ash" }] });
    } finally {
      await host.stop();
    }
  });

  it("lists a Map without a subtitle when the Library read fails", async () => {
    const host = createTestHost({
      manifest: mapsManifest(),
      library: { books: BOOKS },
      storage: seededStorage(),
      permissions: ["editor:write", "files:pick", "files:save"],
    });
    startMaps(createPluginClient(host.port), servePluginUi);
    try {
      const result = await host.broker.request(PLUGIN_CANVAS_REFERENCE_LIST_REQUEST, {
        source: "maps",
        query: "coast",
      });
      expect(result).toEqual({ rows: [{ id: "m1", title: "Coast" }] });
    } finally {
      await host.stop();
    }
  });

  it("resolves a present Map and reports a deleted one missing", async () => {
    const storage = seededStorage();
    const previews = new Map(
      (storage.get(INDEX_KEY) as MapIndexEntry[]).map((row) => [row.id, row.preview])
    );
    const host = hostFor(storage);
    try {
      const answer = (await host.broker.request(PLUGIN_CANVAS_REFERENCE_RESOLVE_REQUEST, {
        source: "maps",
        ids: ["m1", "m3"],
      })) as Record<string, { status: string; image?: string }>;
      // Each present answer carries the Map's own index preview (#847).
      expect(answer).toEqual({
        m1: {
          status: "present",
          title: "Coast",
          subtitle: "Tides of Ash",
          image: previews.get("m1"),
        },
        m3: { status: "present", title: "Loose", image: previews.get("m3") },
      });
      expect(answer.m1?.image).toMatch(/^data:image\/svg\+xml,/);
      expect(answer.m3?.image).toMatch(/^data:image\/svg\+xml,/);

      await removeStoredMap(storage, "m1");
      await expect(
        host.broker.request(PLUGIN_CANVAS_REFERENCE_RESOLVE_REQUEST, {
          source: "maps",
          ids: ["m1"],
        })
      ).resolves.toEqual({ m1: { status: "missing" } });
    } finally {
      await host.stop();
    }
  });

  it("opens the Map page for a listed Map", async () => {
    const host = hostFor(seededStorage());
    try {
      await expect(
        host.broker.request(PLUGIN_CANVAS_REFERENCE_OPEN_REQUEST, { source: "maps", id: "m2" })
      ).resolves.toBe("opened");
      expect(host.pageNavigations).toContainEqual({ pluginId: "maibuk-maps", pageId: MAP_PAGE_ID });
    } finally {
      await host.stop();
    }
  });

  it("answers missing when the Map is gone", async () => {
    const storage = seededStorage();
    const host = hostFor(storage);
    try {
      await removeStoredMap(storage, "m2");
      await expect(
        host.broker.request(PLUGIN_CANVAS_REFERENCE_OPEN_REQUEST, { source: "maps", id: "m2" })
      ).resolves.toBe("missing");
      expect(host.pageNavigations).toEqual([]);
    } finally {
      await host.stop();
    }
  });
});

describe("Map editor Commands", () => {
  const MAP_COMMANDS = [
    "undo",
    "redo",
    "zoomIn",
    "zoomOut",
    "zoomReset",
    "panLeft",
    "panRight",
    "panUp",
    "panDown",
    "moveLeft",
    "moveRight",
    "moveUp",
    "moveDown",
    "moveLeftFar",
    "moveRightFar",
    "moveUpFar",
    "moveDownFar",
    "scaleUp",
    "scaleDown",
    "scaleUpFine",
    "scaleDownFine",
    "rotateClockwise",
    "rotateCounterClockwise",
    "rotateClockwiseFine",
    "rotateCounterClockwiseFine",
    "selectTool",
    "handTool",
    "pencilTool",
    "penTool",
    "bucketTool",
    "areaTool",
    "ellipseTool",
    "rectangleTool",
    "polygonTool",
    "insertTool",
    "textTool",
    "eraserTool",
    "roughen",
    "deleteElement",
  ];

  it("binds every Map editor Command, bare Arrows included", () => {
    registerMapCommands();
    for (const id of MAP_COMMANDS) {
      const full = `plugin.maibuk-maps.${id}` as CommandId;
      expect(effectiveShortcuts(full, {}, false).length, id).toBeGreaterThan(0);
    }
    expect(effectiveShortcuts("plugin.maibuk-maps.moveRight", {}, false)).toContainEqual([
      "ArrowRight",
    ]);
    expect(effectiveShortcuts("plugin.maibuk-maps.moveLeft", {}, false)).toContainEqual([
      "ArrowLeft",
    ]);
    expect(effectiveShortcuts("plugin.maibuk-maps.moveDownFar", {}, false)).toContainEqual([
      "Shift+ArrowDown",
    ]);
    expect(effectiveShortcuts("plugin.maibuk-maps.scaleUp", {}, false)).toContainEqual(["]"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.scaleDown", {}, false)).toContainEqual(["["]);
    expect(effectiveShortcuts("plugin.maibuk-maps.scaleUpFine", {}, false)).toContainEqual([
      "Shift+]",
    ]);
    expect(effectiveShortcuts("plugin.maibuk-maps.scaleDownFine", {}, false)).toContainEqual([
      "Shift+[",
    ]);
    expect(effectiveShortcuts("plugin.maibuk-maps.rotateClockwise", {}, false)).toContainEqual([
      ".",
    ]);
    expect(
      effectiveShortcuts("plugin.maibuk-maps.rotateCounterClockwise", {}, false)
    ).toContainEqual([","]);
    expect(effectiveShortcuts("plugin.maibuk-maps.rotateClockwiseFine", {}, false)).toContainEqual([
      "Shift+.",
    ]);
    expect(
      effectiveShortcuts("plugin.maibuk-maps.rotateCounterClockwiseFine", {}, false)
    ).toContainEqual(["Shift+,"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.handTool", {}, false)).toContainEqual(["h"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.penTool", {}, false)).toContainEqual(["n"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.bucketTool", {}, false)).toContainEqual(["b"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.areaTool", {}, false)).toContainEqual(["a"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.insertTool", {}, false)).toContainEqual(["i"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.textTool", {}, false)).toContainEqual(["t"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.ellipseTool", {}, false)).toContainEqual(["o"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.rectangleTool", {}, false)).toContainEqual(["r"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.polygonTool", {}, false)).toContainEqual(["s"]);
    expect(effectiveShortcuts("plugin.maibuk-maps.eraserTool", {}, false)).toContainEqual(["e"]);
    // Mod+Shift+r is core `editor.alignRight` in the editor, which no route
    // shows beside the Map page, so the binding is live here.
    expect(effectiveShortcuts("plugin.maibuk-maps.roughen", {}, false)).toContainEqual([
      "Mod+Shift+r",
    ]);
  });
});

describe("Map editor Place dialog", () => {
  /** The portrait page `mapStorage` gives its Map: 6 by 9 inches. */
  const PAGE = { preset: "portrait" as const, widthMm: 152.4, heightMm: 228.6 };

  it("places the Map in a Chapter by keyboard, with its alt text and one log line", async () => {
    const storage = mapStorage([]);
    const { host, runtime, insert } = placeHostFor(storage);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(await runtime.openMap("m1")).toBe(true);
      frameStandIn(runtime.editor);
      const page = await host.renderPage(MAP_PAGE_ID);
      const user = userEvent.setup({ delay: null });

      const placeButton = await screen.findByRole("button", { name: en["place.label"] });
      await tabTo(user, placeButton, 120);
      await user.keyboard("{Enter}");

      const dialog = await screen.findByRole("dialog", { name: en["place.title"] });
      // The Map's own name is the alt text until the author edits it.
      const alt = within(dialog).getByRole("textbox", { name: en["place.alt"] });
      expect(alt).toHaveValue("Coast");

      // The picker lists the Map's Book's Chapters and Notes.
      await within(dialog).findByLabelText(en["place.target"]);
      await pickOption(user, en["place.target"], "Chapter One", dialog);

      await tabTo(user, alt);
      await user.keyboard("{Control>}a{/Control}The Reach & Tides");
      await waitFor(() => expect(alt).toHaveValue("The Reach & Tides"));

      const submit = within(dialog).getByRole("button", { name: en["place.submit"] });
      await tabTo(user, submit);
      await user.keyboard("{Enter}");

      await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      expect(host.navigations).toEqual([{ entity: { kind: "chapter", id: "c1" } }]);
      expect(insert).toHaveBeenCalledWith({
        content: { html: '<img src="data:image/png;base64,iVBORw==" alt="The Reach &amp; Tides">' },
      });

      const size = placePixelSize(PAGE);
      expect(info).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledWith(
        exportLogLine({
          action: "insert",
          format: "png",
          widthPx: size.widthPx,
          heightPx: size.heightPx,
          bytes: 4,
        })
      );

      await page.unmount();
    } finally {
      info.mockRestore();
      await host.stop();
    }
  });

  it("shows the panel error and navigates nowhere when the picture is too large", async () => {
    const storage = mapStorage([]);
    const { host, runtime, insert } = placeHostFor(storage);
    try {
      // 80% of the cap in bytes is over it as a data URI at every quality.
      frameStandIn(runtime.editor, new Uint8Array(Math.floor(INSERT_IMAGE_CAP_BYTES * 0.8)));
      expect(await runtime.openMap("m1")).toBe(true);
      const page = await host.renderPage(MAP_PAGE_ID);
      const user = userEvent.setup({ delay: null });

      const placeButton = await screen.findByRole("button", { name: en["place.label"] });
      await tabTo(user, placeButton, 120);
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog", { name: en["place.title"] });
      await within(dialog).findByLabelText(en["place.target"]);

      const submit = within(dialog).getByRole("button", { name: en["place.submit"] });
      await tabTo(user, submit);
      await user.keyboard("{Enter}");

      expect(await screen.findByText(en["place.failed"])).toBeInTheDocument();
      expect(host.navigations).toEqual([]);
      expect(insert).not.toHaveBeenCalled();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("closes the Place dialog on Escape and returns focus to its button", async () => {
    const storage = mapStorage([]);
    const { host, runtime, insert } = placeHostFor(storage);
    try {
      expect(await runtime.openMap("m1")).toBe(true);
      frameStandIn(runtime.editor);
      const page = await host.renderPage(MAP_PAGE_ID);
      const user = userEvent.setup({ delay: null });

      const placeButton = await screen.findByRole("button", { name: en["place.label"] });
      await tabTo(user, placeButton, 120);
      await user.keyboard("{Enter}");
      await screen.findByRole("dialog", { name: en["place.title"] });

      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(placeButton).toHaveFocus());
      expect(insert).not.toHaveBeenCalled();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("fits the target picker to the host's cap, with a Library past 2,000 Chapters", async () => {
    // A long Book: more Chapters than the host accepts in one option list, each
    // title well past the length one label may carry.
    const longTitle = "The Northern Reach ".repeat(40);
    const chapters = Array.from({ length: PLUGIN_UI_LIMITS.maxOptions + 100 }, (_, index) => ({
      ...PLACE_CHAPTERS[0],
      id: `c${index + 1}`,
      title: `${index + 1} ${longTitle}`,
      order: index + 1,
    }));
    const storage = mapStorage([]);
    const { host, runtime } = placeHostFor(storage, chapters);
    try {
      expect(await runtime.openMap("m1")).toBe(true);
      frameStandIn(runtime.editor);
      const page = await host.renderPage(MAP_PAGE_ID);
      const user = userEvent.setup({ delay: null });

      const placeButton = await screen.findByRole("button", { name: en["place.label"] });
      await tabTo(user, placeButton, 120);
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog", { name: en["place.title"] });
      const trigger = await within(dialog).findByLabelText(en["place.target"]);

      // The page asked for no option list the host would refuse.
      expect(page.violations).toEqual([]);

      await tabTo(user, trigger);
      await user.keyboard("{Enter}");
      const listbox = await screen.findByRole("listbox");
      // By selector: a role query over 2000 rows is most of the test's time.
      const options = [...listbox.querySelectorAll<HTMLElement>('[role="option"]')];
      expect(options).toHaveLength(PLUGIN_UI_LIMITS.maxOptions);
      // The first Chapter is still offered, its title cut to the host's 512-code
      // unit cap instead of going whole.
      const first = options[0];
      expect(first).toHaveAccessibleName(/^1 The Northern Reach/);
      expect((first.textContent ?? "").length).toBe(512);
      expect(first.textContent?.endsWith("…")).toBe(true);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("keeps the alt text inside its 500-character bound", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = placeHostFor(storage);
    try {
      expect(await runtime.openMap("m1")).toBe(true);
      frameStandIn(runtime.editor);
      const page = await host.renderPage(MAP_PAGE_ID);
      const user = userEvent.setup({ delay: null });

      const placeButton = await screen.findByRole("button", { name: en["place.label"] });
      await tabTo(user, placeButton, 120);
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog", { name: en["place.title"] });
      const alt = within(dialog).getByRole("textbox", { name: en["place.alt"] });

      // Pasted whole, so the field takes the 600 characters in one edit and
      // keeps only what the insert message's envelope margin leaves room for.
      await tabTo(user, alt);
      await user.keyboard("{Control>}a{/Control}");
      await user.paste("x".repeat(600));
      await waitFor(() => expect(alt).toHaveValue("x".repeat(ALT_TEXT_MAX_CHARS)));

      await page.unmount();
    } finally {
      await host.stop();
    }
  });
});
