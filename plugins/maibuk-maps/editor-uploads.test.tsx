/**
 * Map editor uploads (#756): Custom Stamps, Map Images, and their names and tiles.
 * Every action is reached with `user-event` key presses and asserted by what
 * the host drew and stored; shared fixtures are in `test-support.tsx` (#850).
 */

import { type ReactElement } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ASSETS_KEY, assetKey } from "./assets";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";
import { format } from "./i18n";
import { MAX_NAME_LENGTH, type MapImageElement, type MapStampElement } from "./maps";
import { MAP_PAGE_ID } from "./runtime";
import {
  frameStandIn,
  mapStorage,
  storedMap,
  PICTURE_DATA,
  openEditor,
  tabTo,
  pickTool,
  openLayers,
  tilePicture,
  svgBytes,
  storedAssets,
  storedAsset,
  seedAsset,
  ingested,
  tabToUpload,
} from "./test-support";

// A focused button opens its Tooltip, and Floating UI then reads computed
// style up the whole ancestor chain: in jsdom that was 38% of a keyboard
// test's time (#850). No test here asserts a Tooltip, so it renders its child.
vi.mock("@/components/ui/Tooltip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/Tooltip")>()),
  Tooltip: ({ children }: { children: ReactElement }) => children,
}));

describe("Map editor uploads (#756)", () => {
  it("uploads an SVG as a Custom Stamp by keyboard, lists it, and places it at the view centre", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const frame = frameStandIn(runtime.editor, undefined, ingested);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      host.files.queuePick({ name: "banner.svg", bytes: svgBytes() });
      const user = userEvent.setup({ delay: null });

      await pickTool(user, en["tools.insert"]);
      const upload = await tabToUpload(user);
      expect(upload).toHaveFocus();
      await user.keyboard("{Enter}");

      // The picture lands in the Library under its file name, and the Frame's
      // sanitized bytes are what the Library keeps.
      await waitFor(() => expect(storedAssets(storage)).toHaveLength(1));
      const [row] = storedAssets(storage);
      expect(row).toMatchObject({
        name: "banner",
        mime: "image/svg+xml",
        width: 40,
        height: 20,
        recolorable: true,
        use: "stamp",
      });
      expect(storedAsset(storage, row.id)).toMatchObject({
        name: "banner",
        data: Buffer.from(svgBytes()).toString("base64"),
      });

      // It lands at the page centre, selected, as a Custom Stamp.
      await waitFor(() => expect(runtime.editor?.getSnapshot().elements).toHaveLength(1));
      const stamp = runtime.editor?.getSnapshot().elements[0] as MapStampElement;
      expect(stamp).toMatchObject({
        kind: "stamp",
        name: "banner",
        stampRef: `custom:${row.id}`,
        transform: { x: 76.2, y: 114.3, size: 12, rotation: 0 },
      });
      expect(runtime.editor?.getSnapshot().selectedId).toBe(stamp.id);
      expect(runtime.editor?.getSnapshot().currentStampId).toBe(`custom:${row.id}`);

      // The grid lists the Custom Stamp as the picked tile, drawing the
      // uploaded picture itself, and the Place button names it.
      const tile = await screen.findByRole("button", { name: "banner" });
      await waitFor(() => expect(tile.children).toHaveLength(2));
      await waitFor(() =>
        expect(tilePicture(tile)).toContain(
          `href="data:image/svg+xml;base64,${Buffer.from(svgBytes()).toString("base64")}"`
        )
      );
      expect(
        screen.getByRole("button", {
          name: format(en["properties.placeStamp"], { stamp: "banner" }),
        })
      ).toBeInTheDocument();
      expect(frame.messages.filter((message) => message.kind === "ingest-asset")).toHaveLength(1);

      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0]).toMatchObject({ stampRef: `custom:${row.id}` });
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("uploads a picture as a Map Image by keyboard, at half the page width", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    frameStandIn(runtime.editor, undefined, ingested);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      host.files.queuePick({ name: "trace.png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });
      const user = userEvent.setup({ delay: null });

      await pickTool(user, en["tools.insert"]);
      const asImage = await screen.findByRole("checkbox", { name: en["properties.asMapImage"] });
      await tabTo(user, asImage, 120);
      await user.keyboard(" ");
      await waitFor(() => expect(asImage).toBeChecked());

      const upload = screen.getByRole("button", { name: en["properties.upload"] });
      await tabTo(user, upload, 120);
      await user.keyboard("{Enter}");

      await waitFor(() => expect(storedAssets(storage)).toHaveLength(1));
      const [row] = storedAssets(storage);
      expect(row).toMatchObject({ name: "trace", mime: "image/png", use: "image" });

      await waitFor(() => expect(runtime.editor?.getSnapshot().elements).toHaveLength(1));
      const image = runtime.editor?.getSnapshot().elements[0] as MapImageElement;
      expect(image).toMatchObject({
        kind: "image",
        name: "trace",
        assetRef: row.id,
        transform: { x: 76.2, y: 114.3, size: 76.2, rotation: 0 },
        opacity: 1,
        exportable: true,
      });
      expect(runtime.editor?.getSnapshot().selectedId).toBe(image.id);

      // The panel offers the Map Image's own controls.
      expect(
        await screen.findByRole("slider", { name: en["properties.image.opacity"] })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("switch", { name: en["properties.image.exportable"] })
      ).toBeInTheDocument();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("keeps an upload's name inside the bound a Map's own name has", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    frameStandIn(runtime.editor, undefined, ingested);
    const page = await host.renderPage(MAP_PAGE_ID);
    // A file name is as long as a path allows: this one is far past the bound.
    const fileName = `${"Beacon of the Northern Reach ".repeat(10)}.svg`;
    try {
      host.files.queuePick({ name: fileName, bytes: svgBytes() });
      const user = userEvent.setup({ delay: null });

      await pickTool(user, en["tools.insert"]);
      const upload = await tabToUpload(user);
      expect(upload).toHaveFocus();
      await user.keyboard("{Enter}");

      // The Library keeps the file's own stem, cut the way a Map's name is, so
      // the row and the Stamp picker draw it inside the host's own limits.
      await waitFor(() => expect(storedAssets(storage)).toHaveLength(1));
      const [row] = storedAssets(storage);
      const stem = fileName.slice(0, fileName.length - ".svg".length);
      expect(row.name).toBe(stem.slice(0, MAX_NAME_LENGTH));
      expect(row.name).toHaveLength(MAX_NAME_LENGTH);
      // The host refused no label the page sent it.
      expect(page.violations).toEqual([]);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("describes a Map Image row as one, in the author's language", async () => {
    for (const [language, catalog] of [
      ["en", en],
      ["es", es],
    ] as const) {
      const storage = mapStorage([
        {
          id: "scan",
          kind: "image",
          name: "Scan",
          hidden: false,
          locked: false,
          assetRef: "a1",
          transform: { x: 76.2, y: 114.3, size: 80, rotation: 0 },
          opacity: 1,
          exportable: true,
        } satisfies MapImageElement,
      ]);
      const { host, runtime } = await openEditor(storage, language);
      const page = await host.renderPage(MAP_PAGE_ID);
      try {
        // The Map holds the picture the row describes, and the row's kind names
        // the Element, instead of leaving the author with its flags alone (#756).
        expect(runtime.editor?.getSnapshot().elements[0]?.kind).toBe("image");
        await openLayers(userEvent.setup({ delay: null }));
        await waitFor(() =>
          expect(screen.getByRole("list")).toHaveTextContent(catalog["element.kind.image"])
        );
        expect(catalog["element.kind.image"]).not.toBe("");
      } finally {
        await page.unmount();
        await host.stop();
      }
    }
  });

  it("draws a small Custom Stamp's own picture on its tile, and a dashed frame for one past the budget", async () => {
    const storage = mapStorage([]);
    const row = {
      mime: "image/png",
      width: 40,
      height: 20,
      recolorable: false,
      use: "stamp",
    } as const;
    seedAsset(storage, { ...row, id: "a1", name: "Keep" });
    // A picture past what one tile may carry inside the page's UI tree.
    const heavy = "A".repeat(150_001);
    storage.set(ASSETS_KEY, [...storedAssets(storage), { ...row, id: "a2", name: "Atlas scan" }]);
    storage.set(assetKey("a2"), { ...row, id: "a2", name: "Atlas scan", data: heavy });
    const { host } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await pickTool(user, en["tools.insert"]);

      const keep = await screen.findByRole("button", { name: "Keep" });
      await waitFor(() =>
        expect(tilePicture(keep)).toContain(`href="data:image/png;base64,${PICTURE_DATA}"`)
      );
      expect(tilePicture(keep)).not.toContain("stroke-dasharray");

      // The heavy one stays a dashed frame under its name, and its bytes never
      // enter the page.
      const scan = screen.getByRole("button", { name: "Atlas scan" });
      expect(tilePicture(scan)).toContain("stroke-dasharray");
      expect(tilePicture(scan)).not.toContain("<image");
      expect(page.violations).toEqual([]);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });
});
