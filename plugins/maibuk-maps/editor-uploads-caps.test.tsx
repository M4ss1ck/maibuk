import { type ReactElement } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PLUGIN_UI_LIMITS } from "@/plugin-sdk";
import {
  ASSET_MAX_BYTES,
  ASSETS_KEY,
  CUSTOM_FILLS_KEY,
  type AssetIndexEntry,
  type CustomFill,
} from "./assets";
import en from "./locales/runtime/en.json";
import { format } from "./i18n";
import { MAP_PAGE_ID } from "./runtime";
import {
  frameStandIn,
  areaFill,
  mapStorage,
  openEditor,
  selectRow,
  tabTo,
  pickTool,
  svgBytes,
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
  it("fits the Insert Stamp grid to the host's cap, with a Library past 2,000 Custom Stamps", async () => {
    // More uploaded pictures than the host accepts in one option list, each
    // named well past the length one label may carry.
    const longName = "Beacon of the Northern Reach ".repeat(20);
    const rows: AssetIndexEntry[] = Array.from(
      { length: PLUGIN_UI_LIMITS.maxOptions + 100 },
      (_, index) => ({
        id: `a${index + 1}`,
        name: `${index + 1} ${longName}`,
        mime: "image/png",
        width: 40,
        height: 20,
        recolorable: true,
        use: "stamp",
      })
    );
    const storage = mapStorage([]);
    storage.set(ASSETS_KEY, rows);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await pickTool(user, en["tools.insert"]);

      // The Library really is past the cap this test is about.
      expect(runtime.editor?.getSnapshot().library.assets.size).toBe(
        PLUGIN_UI_LIMITS.maxOptions + 100
      );

      // By selector: a role query over 2000 tiles is most of the test's time.
      const first = await waitFor(() => {
        const picture = document.querySelector(`button > img[alt="${en["stamp.capital"]}"]`);
        if (picture === null) throw new Error("the Stamp grid is not drawn yet");
        return picture;
      });
      const grid = first.parentElement?.parentElement as HTMLElement;
      const tiles = [...grid.querySelectorAll("button > img")];

      // The page asked for no grid the host would refuse.
      expect(page.violations).toEqual([]);
      expect(tiles).toHaveLength(PLUGIN_UI_LIMITS.maxOptions);
      // The Library's Custom Stamps follow the base Stamps, and the last one
      // kept is cut to the host's 512-code unit label cap instead of going whole.
      const last = tiles[tiles.length - 1].getAttribute("alt") ?? "";
      expect(last).toHaveLength(512);
      expect(last.endsWith("…")).toBe(true);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("fits the Custom Fill picker and its Custom Stamps to the host's caps", async () => {
    const longName = "Banner of the Reach ".repeat(20);
    const rows: AssetIndexEntry[] = Array.from(
      { length: PLUGIN_UI_LIMITS.maxOptions + 100 },
      (_, index) => ({
        id: `a${index + 1}`,
        name: `${index + 1} ${longName}`,
        mime: "image/png",
        width: 40,
        height: 20,
        recolorable: true,
        use: "stamp",
      })
    );
    const fills: CustomFill[] = Array.from(
      { length: PLUGIN_UI_LIMITS.maxOptions + 100 },
      (_, index) => ({ id: `f${index + 1}`, name: `${index + 1} Meadow`, texture: "a1" })
    );
    const storage = mapStorage([areaFill({ color: "land" })]);
    storage.set(ASSETS_KEY, rows);
    storage.set(CUSTOM_FILLS_KEY, fills);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await selectRow(user, "Fill 1");

      // The Library really is past the caps this test is about.
      expect(runtime.editor?.getSnapshot().library.assets.size).toBe(
        PLUGIN_UI_LIMITS.maxOptions + 100
      );
      expect(runtime.editor?.getSnapshot().library.customFills.size).toBe(
        PLUGIN_UI_LIMITS.maxOptions + 100
      );

      // The picture rows the page asked for are one node each, so the list is
      // fitted to the same cap: the Library's tail is what it loses.
      const stamps = await screen.findByRole("listbox", {
        name: en["properties.customFill.stamps"],
      });
      // Counted by selector: a role query over 2000 rows computes each one's
      // accessibility, which took most of this test's minute in CI.
      expect(stamps.querySelectorAll('[role="option"]')).toHaveLength(PLUGIN_UI_LIMITS.maxOptions);

      const trigger = await screen.findByLabelText(en["properties.customFill"]);
      await tabTo(user, trigger);
      await user.keyboard("{Enter}");
      const listbox = await screen.findByRole("listbox", { name: en["properties.customFill"] });
      // "None" is the first entry the page offers, so the cap keeps it and 1999
      // Custom Fills after it.
      expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(PLUGIN_UI_LIMITS.maxOptions);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("refuses an upload the size cap already exceeds, and stores nothing", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      // Base64 grows a file by a third, so this one is over the cap unread.
      host.files.queuePick({
        name: "huge.png",
        bytes: new Uint8Array(Math.ceil((ASSET_MAX_BYTES * 3) / 4) + 1),
      });
      const user = userEvent.setup({ delay: null });

      await pickTool(user, en["tools.insert"]);
      const upload = await tabToUpload(user);
      expect(upload).toHaveFocus();
      await user.keyboard("{Enter}");

      const limit = (ASSET_MAX_BYTES / (1024 * 1024)).toFixed(1);
      await screen.findByText(format(en["upload.tooLarge"], { limit }));
      expect(storage.get(ASSETS_KEY)).toBeUndefined();
      expect(runtime.editor?.getSnapshot().elements).toEqual([]);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("shows the invalid-image error when the Frame refuses an upload", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    frameStandIn(runtime.editor, undefined, (message) => ({
      kind: "ingest-error",
      requestId: message.requestId,
      reason: "invalid-image",
    }));
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      host.files.queuePick({ name: "broken.svg", bytes: svgBytes() });
      const user = userEvent.setup({ delay: null });

      await pickTool(user, en["tools.insert"]);
      const upload = await tabToUpload(user);
      expect(upload).toHaveFocus();
      await user.keyboard("{Enter}");

      await screen.findByText(en["upload.invalid"]);
      expect(storage.get(ASSETS_KEY)).toBeUndefined();
      expect(runtime.editor?.getSnapshot().elements).toEqual([]);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });
});
