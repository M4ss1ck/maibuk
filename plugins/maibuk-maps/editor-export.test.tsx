/**
 * The Map editor's Export panel, and the narrow editor's bar and regions (#779).
 * Every action is reached with `user-event` key presses and asserted by what
 * the host drew and stored; shared fixtures are in `test-support.tsx` (#850).
 */

import { type ReactElement } from "react";
import { Blob as NodeBlob } from "node:buffer";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportLogLine, printPixelSize, svgPixelSize } from "./export";
import en from "./locales/runtime/en.json";
import { MAP_LABEL_FONT_FAMILIES, newLabel } from "./maps";
import { MAP_PAGE_ID } from "./runtime";
import {
  frameStandIn,
  exportHostFor,
  line,
  areaFill,
  mapStorage,
  PICTURE_DATA,
  pictureStorage,
  openEditor,
  elementsList,
  tabTo,
  pickTool,
  openLayers,
  openExport,
} from "./test-support";

// A focused button opens its Tooltip, and Floating UI then reads computed
// style up the whole ancestor chain: in jsdom that was 38% of a keyboard
// test's time (#850). No test here asserts a Tooltip, so it renders its child.
vi.mock("@/components/ui/Tooltip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/Tooltip")>()),
  Tooltip: ({ children }: { children: ReactElement }) => children,
}));

describe("Map editor Export panel", () => {
  /** The portrait page `mapStorage` gives its Map: 6 by 9 inches. */
  const PAGE = { preset: "portrait" as const, widthMm: 152.4, heightMm: 228.6 };

  // jsdom's Blob is a stand-in class the in-process MessageChannel turns into a
  // plain object; Node's real Blob crosses the port the way a browser's does,
  // so the host's own save flow runs (`test-kit.test.ts` does the same).
  beforeEach(() => {
    vi.stubGlobal("Blob", NodeBlob);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves a PNG at the print size and DPI typed by keyboard, and logs one line", async () => {
    const storage = mapStorage([
      line("e1", "Coastline", [
        [10, 10],
        [20, 20],
      ]),
    ]);
    const { host, runtime } = exportHostFor(storage);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(await runtime.openMap("m1")).toBe(true);
      const frame = frameStandIn(runtime.editor);
      const page = await host.renderPage(MAP_PAGE_ID);
      const user = userEvent.setup({ delay: null });
      // The Export panel is the top-right pill's popover (#778), so it opens first.
      await openExport(user);

      // PNG is the panel's default, and the page is 6 in wide.
      const png = await screen.findByRole("radio", { name: en["export.format.png"] });
      expect(png).toBeChecked();
      expect(screen.getByRole("textbox", { name: en["export.printWidth"] })).toHaveValue("6");

      // Tab to the DPI field, type 150, and press Enter on Save.
      const dpi = screen.getByRole("textbox", { name: en["export.dpi"] });
      await tabTo(user, dpi, 120);
      await user.keyboard("{Control>}a{/Control}150{Enter}");
      await waitFor(() => expect(dpi).toHaveValue("150"));

      const save = screen.getByRole("button", { name: en["export.save"] });
      await tabTo(user, save, 120);
      await user.keyboard("{Enter}");

      await waitFor(() => expect(host.files.saves).toHaveLength(1));
      const [saved] = host.files.saves;
      expect(saved.name).toBe("Coast.png");
      expect(saved.mimeType).toBe("image/png");
      expect([...saved.bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);

      // The Frame was asked to draw the 6 in page at 150 DPI.
      const size = printPixelSize(PAGE, 6, 150);
      const request = frame.messages.find((message) => message.kind === "rasterize");
      expect(request).toMatchObject({
        widthPx: size.widthPx,
        heightPx: size.heightPx,
        format: "png",
      });

      expect(info).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledWith(
        exportLogLine({
          action: "save",
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

  it("saves an SVG that embeds only the fonts it uses and no editor marks", async () => {
    const storage = mapStorage([
      newLabel({
        id: "l1",
        name: "Map Label 1",
        text: "The Reach",
        point: [76.2, 114.3],
        font: "cinzel",
      }),
    ]);
    const { host, runtime } = exportHostFor(storage);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(await runtime.openMap("m1")).toBe(true);
      frameStandIn(runtime.editor);
      const page = await host.renderPage(MAP_PAGE_ID);
      const user = userEvent.setup({ delay: null });
      // The Export panel is the top-right pill's popover (#778), so it opens first.
      await openExport(user);

      // Tab into the Format group and pick SVG with the arrow key.
      const group = await screen.findByRole("radiogroup", { name: en["export.format"] });
      for (let i = 0; i < 80 && !group.contains(document.activeElement); i++) await user.tab();
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect(screen.getByRole("radio", { name: en["export.format.svg"] })).toBeChecked()
      );
      // The Plugin re-renders for SVG once it hears the change; DPI is PNG only.
      await waitFor(() => expect(screen.queryByLabelText(en["export.dpi"])).toBeNull());

      const save = screen.getByRole("button", { name: en["export.save"] });
      await tabTo(user, save, 120);
      await user.keyboard("{Enter}");

      await waitFor(() => expect(host.files.saves).toHaveLength(1));
      const [saved] = host.files.saves;
      expect(saved.name).toBe("Coast.svg");
      expect(saved.mimeType).toBe("image/svg+xml");

      const svg = new TextDecoder().decode(saved.bytes);
      expect(svg).not.toContain("data-element-id");
      expect(svg.match(/@font-face/g)).toHaveLength(1);
      expect(svg).toContain(`@font-face{font-family:"${MAP_LABEL_FONT_FAMILIES.cinzel}"`);
      expect(svg).not.toContain(MAP_LABEL_FONT_FAMILIES["medieval-sharp"]);

      // The SVG log names the size a browser draws it at, 96 DPI.
      const size = svgPixelSize(PAGE);
      expect(info).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledWith(
        exportLogLine({
          action: "save",
          format: "svg",
          widthPx: size.widthPx,
          heightPx: size.heightPx,
          bytes: saved.bytes.length,
        })
      );

      await page.unmount();
    } finally {
      info.mockRestore();
      await host.stop();
    }
  });

  it("draws a Map Image in the editor and keeps its id in the rasterize message", async () => {
    const { host, runtime } = exportHostFor(pictureStorage());
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(await runtime.openMap("m1")).toBe(true);
      const frame = frameStandIn(runtime.editor);
      const page = await host.renderPage(MAP_PAGE_ID);
      const user = userEvent.setup({ delay: null });
      // The Export panel is the top-right pill's popover (#778), so it opens first.
      await openExport(user);

      // The page hands the editor the Library once it has loaded, and the editor
      // hands the Frame the picture's bytes once, by id.
      await waitFor(() =>
        expect(frame.messages.filter((message) => message.kind === "asset")).toEqual([
          { kind: "asset", id: "a1", mime: "image/png", data: PICTURE_DATA },
        ])
      );

      const save = await screen.findByRole("button", { name: en["export.save"] });
      await tabTo(user, save, 120);
      await user.keyboard("{Enter}");

      await waitFor(() => expect(host.files.saves).toHaveLength(1));
      const svg = String(frame.messages.find((message) => message.kind === "rasterize")?.svg ?? "");
      // The bytes stay in the Frame; the request carries the id it draws.
      expect(svg).toContain('href="asset:a1"');
      expect(svg).not.toContain("data:image");
      // The Map Image the author kept out of exports draws nowhere.
      expect(svg.match(/<image /g)).toHaveLength(1);

      await page.unmount();
    } finally {
      info.mockRestore();
      await host.stop();
    }
  });

  it("embeds a picture's bytes in a saved SVG, so the file reads on its own", async () => {
    const { host, runtime } = exportHostFor(pictureStorage());
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(await runtime.openMap("m1")).toBe(true);
      frameStandIn(runtime.editor);
      const page = await host.renderPage(MAP_PAGE_ID);
      const user = userEvent.setup({ delay: null });
      // The Export panel is the top-right pill's popover (#778), so it opens first.
      await openExport(user);

      const group = await screen.findByRole("radiogroup", { name: en["export.format"] });
      for (let i = 0; i < 80 && !group.contains(document.activeElement); i++) await user.tab();
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect(screen.getByRole("radio", { name: en["export.format.svg"] })).toBeChecked()
      );
      // The Plugin re-renders for SVG once it hears the change; DPI is PNG only.
      await waitFor(() => expect(screen.queryByLabelText(en["export.dpi"])).toBeNull());

      const save = screen.getByRole("button", { name: en["export.save"] });
      await tabTo(user, save, 120);
      await user.keyboard("{Enter}");

      await waitFor(() => expect(host.files.saves).toHaveLength(1));
      const svg = new TextDecoder().decode(host.files.saves[0].bytes);
      expect(svg).toContain(`href="data:image/png;base64,${PICTURE_DATA}"`);
      expect(svg).not.toContain("asset:");
      expect(svg.match(/<image /g)).toHaveLength(1);

      await page.unmount();
    } finally {
      info.mockRestore();
      await host.stop();
    }
  });

  it("logs nothing and shows no error when the author cancels the save", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = exportHostFor(storage);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      expect(await runtime.openMap("m1")).toBe(true);
      frameStandIn(runtime.editor);
      const page = await host.renderPage(MAP_PAGE_ID);
      const user = userEvent.setup({ delay: null });
      // The Export panel is the top-right pill's popover (#778), so it opens first.
      await openExport(user);
      host.files.queueSaveCancel();

      const save = await screen.findByRole("button", { name: en["export.save"] });
      await tabTo(user, save, 120);
      await user.keyboard("{Enter}");

      // A later request settles after the save the host answered with a cancel.
      await expect(host.broker.request("health.check", null)).resolves.toBe("pong");
      expect(host.files.saves).toEqual([]);
      expect(info).not.toHaveBeenCalled();
      // A cancelled save is not a failure: the panel says nothing.
      expect(screen.queryByText(en["export.failed"])).not.toBeInTheDocument();

      await page.unmount();
    } finally {
      info.mockRestore();
      await host.stop();
    }
  });
});

describe("the narrow editor's bar and regions (#779)", () => {
  // The saved picture crosses the in-process MessageChannel as Node's Blob does
  // in a browser, as the Export suite above arranges.
  beforeEach(() => {
    vi.stubGlobal("Blob", NodeBlob);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reaches Map Style, Place, and Export behind one overflow popover, and exports by keyboard", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    frameStandIn(runtime.editor);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      // The narrow bar folds the pill's three controls into one popover; the
      // stylesheet is what shows it in their place, so the same control the
      // narrow page draws is the one this test drives.
      const more = await screen.findByRole("button", { name: en["chrome.more"] });
      await tabTo(user, more, 120);
      await user.keyboard("{Enter}");
      const panel = await screen.findByRole("dialog");

      // The three paths are all in it: the Style picker, Place, and Export.
      expect(
        within(panel).getByRole("radiogroup", { name: en["properties.mapStyle"] })
      ).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: en["place.label"] })).toBeInTheDocument();

      // Export saves the Map from the overflow, exactly as the pill's own does.
      const save = within(panel).getByRole("button", { name: en["export.save"] });
      await tabTo(user, save, 60);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(host.files.saves).toHaveLength(1));
      expect(host.files.saves[0]).toMatchObject({ name: "Coast.png", mimeType: "image/png" });
      info.mockRestore();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("expands the Properties region to full height and back by keyboard", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      // A Pen selection keeps the Properties card on the page with no Element.
      await pickTool(user, en["tools.pen"]);
      const full = await screen.findByRole("button", { name: en["chrome.expandProperties"] });
      expect(full).toHaveAttribute("aria-pressed", "false");
      const pageBefore = runtime.editor?.getSnapshot().doc.page;

      await tabTo(user, full, 120);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(full).toHaveAttribute("aria-pressed", "true"));
      // The region grew, and the drawing's own page did not resize with it.
      expect(await screen.findByLabelText(en["properties.lineStyle"])).toBeInTheDocument();
      expect(runtime.editor?.getSnapshot().doc.page).toEqual(pageBefore);

      await user.keyboard("{Enter}");
      await waitFor(() => expect(full).toHaveAttribute("aria-pressed", "false"));
      expect(await screen.findByLabelText(en["properties.lineStyle"])).toBeInTheDocument();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("expands the Layers region to full height and back by keyboard", async () => {
    const storage = mapStorage([areaFill({ color: "land" })]);
    const { host } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await openLayers(user);
      const list = await screen.findByRole("list");

      const full = await screen.findByRole("button", { name: en["chrome.expandLayers"] });
      expect(full).toHaveAttribute("aria-pressed", "false");

      await tabTo(user, full, 120);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(full).toHaveAttribute("aria-pressed", "true"));
      // The region is still the Layers card and holds the same list: the toggle
      // changes how tall the region draws, not what it lists. Its geometry is
      // `@wf:plugins-maps-layout`'s, measured in a real browser (#779).
      expect(elementsList()).toBe(list);
      expect(within(list).getByRole("button", { name: /^Fill 1/ })).toBeInTheDocument();

      await user.keyboard("{Enter}");
      await waitFor(() => expect(full).toHaveAttribute("aria-pressed", "false"));
      expect(elementsList()).toBe(list);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });
});
