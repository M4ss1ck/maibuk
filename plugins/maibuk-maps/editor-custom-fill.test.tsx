import { type ReactElement } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CUSTOM_FILLS_KEY, type CustomFill } from "./assets";
import en from "./locales/runtime/en.json";
import { type MapImageElement } from "./maps";
import { MAP_PAGE_ID } from "./runtime";
import {
  frameStandIn,
  areaFill,
  mapStorage,
  storedMap,
  openEditor,
  selectRow,
  tabTo,
  fillNow,
  storedFill,
  pickOption,
  svgBytes,
  storedAssets,
  seedAsset,
  addMap,
  ingested,
} from "./test-support";

// A focused button opens its Tooltip, and Floating UI then reads computed
// style up the whole ancestor chain: in jsdom that was 38% of a keyboard
// test's time (#850). No test here asserts a Tooltip, so it renders its child.
vi.mock("@/components/ui/Tooltip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/Tooltip")>()),
  Tooltip: ({ children }: { children: ReactElement }) => children,
}));

describe("Map editor uploads (#756)", () => {
  it("resizes, fades, and keeps a Map Image out of exports from the keyboard", async () => {
    const scan: MapImageElement = {
      id: "scan",
      kind: "image",
      name: "Scan",
      hidden: false,
      locked: false,
      assetRef: "a1",
      transform: { x: 76.2, y: 114.3, size: 80, rotation: 0 },
      opacity: 1,
      exportable: true,
    };
    const storage = mapStorage([scan]);
    seedAsset(storage, {
      id: "a1",
      name: "Scan",
      mime: "image/png",
      width: 40,
      height: 20,
      recolorable: false,
      use: "image",
    });
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await selectRow(user, "Scan");

      const size = await screen.findByRole("textbox", { name: en["properties.image.size"] });
      await tabTo(user, size, 120);
      await user.keyboard("{Control>}a{/Control}30{Enter}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapImageElement).transform.size).toBe(
          30
        )
      );

      const opacity = await screen.findByRole("slider", { name: en["properties.image.opacity"] });
      await tabTo(user, opacity, 120);
      await user.keyboard("{ArrowLeft}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapImageElement).opacity).toBeCloseTo(
          0.99
        )
      );

      const include = await screen.findByRole("switch", {
        name: en["properties.image.exportable"],
      });
      await tabTo(user, include, 120);
      await user.keyboard(" ");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapImageElement).exportable).toBe(
          false
        )
      );

      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0]).toMatchObject({
        transform: { size: 30 },
        opacity: 0.99,
        exportable: false,
      });

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("applies a Library Custom Fill from the keyboard, and a second Map sees it", async () => {
    const storage = mapStorage([areaFill({ color: "land" })]);
    addMap(storage, "m2", "Second");
    seedAsset(storage, {
      id: "a1",
      name: "Banner",
      mime: "image/png",
      width: 40,
      height: 20,
      recolorable: true,
      use: "stamp",
    });
    const meadow: CustomFill = { id: "meadow", name: "Meadow", texture: "a1" };
    storage.set(CUSTOM_FILLS_KEY, [meadow]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await selectRow(user, "Fill 1");

      await pickOption(user, en["properties.customFill"], "Meadow");
      await waitFor(() => expect(fillNow(runtime).content.customFill).toBe("meadow"));
      await runtime.editor?.flush();
      expect(storedFill(storage).content.customFill).toBe("meadow");

      // A second Map reads the same Library-wide pictures and Custom Fills.
      await page.unmount();
      expect(await runtime.openMap("m2")).toBe(true);
      const second = await host.renderPage(MAP_PAGE_ID);
      await waitFor(() =>
        expect(runtime.editor?.getSnapshot().library.customFills.has("meadow")).toBe(true)
      );
      expect(runtime.editor?.getSnapshot().library.assets.has("a1")).toBe(true);
      await second.unmount();
    } finally {
      await host.stop();
    }
  });

  it("builds a Custom Fill from an uploaded texture and applies it by keyboard", async () => {
    const storage = mapStorage([areaFill({ color: "land" })]);
    const { host, runtime } = await openEditor(storage);
    frameStandIn(runtime.editor, undefined, ingested);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      host.files.queuePick({ name: "moss.svg", bytes: svgBytes() });
      const user = userEvent.setup({ delay: null });
      await selectRow(user, "Fill 1");

      const fromTexture = await screen.findByRole("button", {
        name: en["properties.customFill.texture"],
      });
      await tabTo(user, fromTexture, 120);
      await user.keyboard("{Enter}");

      await waitFor(() => expect(storage.get(CUSTOM_FILLS_KEY)).toHaveLength(1));
      const [fill] = storage.get(CUSTOM_FILLS_KEY) as CustomFill[];
      expect(fill).toMatchObject({ name: "Custom Fill 1", texture: expect.any(String) });
      await waitFor(() => expect(fillNow(runtime).content.customFill).toBe(fill.id));
      expect(storedAssets(storage)[0]).toMatchObject({ name: "moss", use: "texture" });

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("builds a Custom Fill from chosen Custom Stamps and applies it by keyboard", async () => {
    const storage = mapStorage([areaFill({ color: "land" })]);
    seedAsset(storage, {
      id: "a1",
      name: "Banner",
      mime: "image/png",
      width: 40,
      height: 20,
      recolorable: true,
      use: "stamp",
    });
    seedAsset(storage, {
      id: "a2",
      name: "Crest",
      mime: "image/png",
      width: 40,
      height: 20,
      recolorable: true,
      use: "stamp",
    });
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await selectRow(user, "Fill 1");

      const stamps = await screen.findByRole("listbox", {
        name: en["properties.customFill.stamps"],
      });
      // The Collection's row is the tab stop, not its listbox: focus it, then
      // Space toggles its selection.
      const banner = within(stamps).getByRole("option", { name: "Banner" });
      await tabTo(user, banner, 120);
      expect(banner).toHaveFocus();
      await user.keyboard(" ");
      await waitFor(() => expect(banner).toHaveAttribute("aria-selected", "true"));

      const create = await screen.findByRole("button", {
        name: en["properties.customFill.create"],
      });
      await tabTo(user, create, 120);
      await user.keyboard("{Enter}");

      await waitFor(() => expect(storage.get(CUSTOM_FILLS_KEY)).toHaveLength(1));
      const [fill] = storage.get(CUSTOM_FILLS_KEY) as CustomFill[];
      expect(fill).toMatchObject({
        name: "Custom Fill 1",
        stamps: ["custom:a1"],
      });
      await waitFor(() => expect(fillNow(runtime).content.customFill).toBe(fill.id));

      await page.unmount();
    } finally {
      await host.stop();
    }
  });
});
