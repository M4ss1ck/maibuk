/**
 * The Map editor: the Insert card, the Text tool, Stamps, and the scale bar.
 * Every action is reached with `user-event` key presses and asserted by what
 * the host drew and stored; shared fixtures are in `test-support.tsx` (#850).
 */

import { type ReactElement } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import en from "./locales/runtime/en.json";
import { format } from "./i18n";
import { type MapStampElement } from "./maps";
import { MAP_PAGE_ID } from "./runtime";
import { BASE_STAMP_IDS } from "./stamps";
import {
  mapStorage,
  storedMap,
  registerMapCommands,
  CommandKeys,
  openEditor,
  elementsList,
  focusPanelButton,
  tabTo,
  pickTool,
  pickedTool,
  openLayers,
  pickStamp,
  tilePicture,
} from "./test-support";

// A focused button opens its Tooltip, and Floating UI then reads computed
// style up the whole ancestor chain: in jsdom that was 38% of a keyboard
// test's time (#850). No test here asserts a Tooltip, so it renders its child.
vi.mock("@/components/ui/Tooltip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/Tooltip")>()),
  Tooltip: ({ children }: { children: ReactElement }) => children,
}));

describe("Map editor page", () => {
  it("draws the Insert card as a grid of Stamp pictures, then the size, Place, and the upload controls", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await pickTool(user, en["tools.insert"]);

      // One tile per base Stamp, in the Stamps' own order, each a button named
      // after its Stamp and drawing that Stamp as a picture.
      const capital = await screen.findByRole("button", { name: en["stamp.capital"] });
      const grid = capital.parentElement as HTMLElement;
      const tiles = within(grid).getAllByRole("button");
      expect(tiles.map((tile) => within(tile).getByRole("img").getAttribute("alt"))).toEqual(
        BASE_STAMP_IDS.map((id) => en[`stamp.${id}` as keyof typeof en])
      );
      for (const tile of tiles) expect(tilePicture(tile)).toContain("<svg");
      // No two Stamps share a picture.
      expect(new Set(tiles.map(tilePicture)).size).toBe(tiles.length);

      // The card reads top to bottom: the grid, the size, Place, the divider,
      // the Map Image checkbox, then Upload.
      const order = [
        grid,
        screen.getByRole("textbox", { name: en["properties.stamp.newSize"] }),
        screen.getByRole("button", {
          name: format(en["properties.placeStamp"], { stamp: en["stamp.capital"] }),
        }),
        screen.getByText(en["properties.uploadOwn"]),
        screen.getByRole("checkbox", { name: en["properties.asMapImage"] }),
        screen.getByRole("button", { name: en["properties.upload"] }),
      ];
      for (let i = 1; i < order.length; i++) {
        expect(
          order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
      }
      // Upload says what it does in words, not by an icon alone.
      expect(order[5]).toHaveTextContent(en["properties.upload"]);

      // A Map Label is the Text tool's, so Insert no longer offers one.
      expect(screen.queryByRole("button", { name: en["properties.mapLabel.place"] })).toBeNull();
      expect(runtime.editor?.getSnapshot().elements).toHaveLength(0);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("selects the Text tool by its key and from the belt, and offers its Place path", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup({ delay: null });
      await screen.findByRole("button", { name: en["tools.text"] });
      await focusPanelButton(user);

      await user.keyboard("t");
      await waitFor(() => expect(runtime.editor?.getSnapshot().tool).toBe("text"));
      await waitFor(() =>
        expect(pickedTool(en["tools.text"])).toHaveAttribute("aria-pressed", "true")
      );
      await screen.findByRole("button", { name: en["properties.mapLabel.place"] });
      // The Text tool opens no Insert card.
      expect(screen.queryByRole("button", { name: en["properties.upload"] })).toBeNull();

      await user.keyboard("v");
      await waitFor(() => expect(runtime.editor?.getSnapshot().tool).toBe("select"));
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: en["properties.mapLabel.place"] })).toBeNull()
      );
      await pickTool(user, en["tools.text"]);
      expect(runtime.editor?.getSnapshot().tool).toBe("text");

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("inserts a castle Stamp from the grid by keyboard, then moves, resizes, and deletes it", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup({ delay: null });

      // The Insert tool by its place in the tool belt, and the Stamp grid it shows.
      await pickTool(user, en["tools.insert"]);
      expect(runtime.editor?.getSnapshot().tool).toBe("insert");
      expect(runtime.editor?.getSnapshot().currentStampId).toBe("capital");

      const tile = await pickStamp(user, en["stamp.castle"]);
      await waitFor(() => expect(runtime.editor?.getSnapshot().currentStampId).toBe("castle"));
      // The picked tile alone holds the mark the stylesheet rings it by.
      await waitFor(() => expect(tile.children).toHaveLength(2));
      expect(screen.getByRole("button", { name: en["stamp.capital"] }).children).toHaveLength(1);

      const place = await screen.findByRole("button", {
        name: format(en["properties.placeStamp"], { stamp: en["stamp.castle"] }),
      });
      await tabTo(user, place, 120);
      await user.keyboard("{Enter}");

      // A Castle Stamp at the page centre of the portrait page, and selected.
      await waitFor(() => expect(runtime.editor?.getSnapshot().elements).toHaveLength(1));
      const inserted = runtime.editor?.getSnapshot().elements[0] as MapStampElement;
      expect(inserted).toMatchObject({
        kind: "stamp",
        name: en["stamp.castle"],
        stampRef: "base:castle",
        transform: { x: 76.2, y: 114.3, size: 12, rotation: 0 },
      });
      expect(runtime.editor?.getSnapshot().selectedId).toBe(inserted.id);
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0]).toMatchObject({
        id: inserted.id,
        stampRef: "base:castle",
      });

      // The Elements list calls the row a Stamp, as it calls a line a Map Line.
      // The description reaches the page over the Remote UI bridge, one hop
      // after the row itself, so the assertion waits for it.
      await openLayers(user);
      await waitFor(() => expect(elementsList()).toHaveTextContent(en["element.kind.stamp"]));

      // One arrow moves the selected Stamp one page millimetre.
      await focusPanelButton(user);
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapStampElement).transform.x).toBe(
          77.2
        )
      );
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapStampElement).transform.x).toBe(77.2);

      // The number fields size and turn it.
      const size = await screen.findByRole("textbox", { name: en["properties.stamp.size"] });
      await tabTo(user, size, 120);
      await user.keyboard("{Control>}a{/Control}20{Enter}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapStampElement).transform.size).toBe(
          20
        )
      );
      const rotation = screen.getByRole("textbox", { name: en["properties.stamp.rotation"] });
      await tabTo(user, rotation, 120);
      await user.keyboard("{Control>}a{/Control}30{Enter}");
      await waitFor(() =>
        expect(
          (runtime.editor?.getSnapshot().elements[0] as MapStampElement).transform.rotation
        ).toBe(30)
      );
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapStampElement).transform).toEqual({
        x: 77.2,
        y: 114.3,
        size: 20,
        rotation: 30,
      });

      // Delete takes the Stamp off the Map and off the Elements list.
      await focusPanelButton(user);
      await user.keyboard("{Delete}");
      await waitFor(() => expect(runtime.editor?.getSnapshot().elements).toHaveLength(0));
      expect(screen.queryByRole("option", { name: en["stamp.castle"] })).not.toBeInTheDocument();
      await runtime.editor?.flush();
      expect(storedMap(storage).elements).toEqual([]);

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("inserts the scale bar and sets its unit and span from the properties panel by keyboard", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });

      await pickTool(user, en["tools.insert"]);
      await pickStamp(user, en["stamp.scale-bar"]);
      const place = await screen.findByRole("button", {
        name: format(en["properties.placeStamp"], { stamp: en["stamp.scale-bar"] }),
      });
      await tabTo(user, place, 120);
      await user.keyboard("{Enter}");

      // The scale bar starts at 40 mm, reading the page's width in kilometres.
      await waitFor(() => expect(runtime.editor?.getSnapshot().elements).toHaveLength(1));
      expect(runtime.editor?.getSnapshot().elements[0]).toMatchObject({
        stampRef: "base:scale-bar",
        transform: { size: 40 },
        scale: { unit: "km", span: 1000 },
      });

      // The bar's size is the longest bar it may draw, so the field says so.
      const maxLength = await screen.findByRole("textbox", {
        name: en["properties.stamp.maxLength"],
      });
      expect(maxLength).toHaveValue("40");

      // The unit is a two-choice group: one arrow picks the other choice.
      const unit = await screen.findByRole("radiogroup", { name: en["properties.stamp.unit"] });
      for (let i = 0; i < 60 && !unit.contains(document.activeElement); i++) await user.tab();
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapStampElement).scale?.unit).toBe(
          "mi"
        )
      );

      const span = await screen.findByRole("textbox", { name: en["properties.stamp.span"] });
      await tabTo(user, span, 120);
      await user.keyboard("{Control>}a{/Control}500{Enter}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapStampElement).scale).toEqual({
          unit: "mi",
          span: 500,
        })
      );
      await runtime.editor?.flush();
      expect((storedMap(storage).elements[0] as MapStampElement).scale).toEqual({
        unit: "mi",
        span: 500,
      });

      // The field's minimum is a span the model keeps: typing 0 commits 1, so
      // the panel never shows a reading the Map has refused.
      await tabTo(user, span, 120);
      await user.keyboard("{Control>}a{/Control}0{Enter}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapStampElement).scale?.span).toBe(1)
      );
      await waitFor(() => expect(span).toHaveValue("1"));

      await page.unmount();
    } finally {
      await host.stop();
    }
  });
});
