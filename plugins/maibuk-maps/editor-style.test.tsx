/**
 * The Map editor: Fill kinds, the Map Style, and the picker's default.
 * Every action is reached with `user-event` key presses and asserted by what
 * the host drew and stored; shared fixtures are in `test-support.tsx` (#850).
 */

import { type ReactElement } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import en from "./locales/runtime/en.json";
import { MAP_PAGE_ID } from "./runtime";
import { MAP_STYLES } from "./styles";
import {
  line,
  areaFill,
  mapStorage,
  storedMap,
  openEditor,
  selectRow,
  tabTo,
  backToRows,
  fillNow,
  lineNow,
  storedLine,
  pickMapStyle,
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
  it("refuses to remove the last kind a Fill has, from the keyboard", async () => {
    const storage = mapStorage([areaFill({ texture: "hatching" })]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await selectRow(user, "Fill 1");

      await pickOption(user, en["properties.fillTexture"], en["properties.none"]);

      // A pick the Worker refuses leaves the Fill as it was: the scatter that
      // lands afterwards proves the refusal was answered, not still in flight.
      await backToRows(user);
      await pickOption(user, en["properties.fillScatter"], en["stamp.castle"]);
      await waitFor(() => expect(fillNow(runtime).content.scatter?.stamp).toBe("base:castle"));

      expect(fillNow(runtime).content.texture).toBe("hatching");
      expect(screen.getByLabelText(en["properties.fillTexture"])).toHaveTextContent(
        en["properties.texture.hatching"]
      );

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("switches the Map Style and clears a Map Line colour, both from the keyboard", async () => {
    const storage = mapStorage([
      line("e1", "Coast", [
        [10, 10],
        [20, 20],
      ]),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await screen.findByRole("button", { name: en["tools.pen"] });
      expect(runtime.editor?.getSnapshot().styleId).toBe("atlas");

      // The Map Style picker is the top-right pill's first popover (#778); its
      // own arrow keys reach Night, and the Map takes it.
      await pickMapStyle(user, en["properties.mapStyle.night"]);
      await waitFor(() => expect(runtime.editor?.getSnapshot().styleId).toBe("night"));
      await runtime.editor?.flush();
      expect(storedMap(storage).styleId).toBe("night");

      await selectRow(user, "Coast");
      // The line follows the Style, so there is no override to clear yet.
      expect(
        screen.getByRole("button", { name: en["properties.useMapStyleColor"] })
      ).toBeDisabled();

      /** Opens the Map Line colour picker and commits one hex colour by keyboard. */
      async function pickLineColor(hex: string): Promise<void> {
        const trigger = screen.getByRole("button", { name: en["properties.mapLine.color"] });
        await tabTo(user, trigger, 120);
        await user.keyboard("{Enter}");
        const dialog = await screen.findByRole("dialog", { name: en["properties.mapLine.color"] });
        const field = within(dialog).getByRole("textbox");
        await user.clear(field);
        await user.type(field, hex);
        await user.keyboard("{Enter}");
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      }

      // A pick of one of Night's own colours stores the role name, so the line
      // keeps following the Style and still has no override to clear.
      await pickLineColor(MAP_STYLES.night.forest);
      await waitFor(() => expect(lineNow(runtime).color).toBe("forest"));
      expect(
        screen.getByRole("button", { name: en["properties.useMapStyleColor"] })
      ).toBeDisabled();

      // Any other hex is an override, which the clear button takes away.
      await pickLineColor("#123456");
      await waitFor(() => expect(lineNow(runtime).color).toBe("#123456"));
      await runtime.editor?.flush();
      expect(storedLine(storage).color).toBe("#123456");

      const clear = screen.getByRole("button", { name: en["properties.useMapStyleColor"] });
      await waitFor(() => expect(clear).toBeEnabled());
      await tabTo(user, clear, 120);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(lineNow(runtime).color).toBeUndefined());
      await runtime.editor?.flush();
      expect(storedLine(storage).color).toBeUndefined();
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: en["properties.useMapStyleColor"] })
        ).toBeDisabled()
      );

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("shows the picker's default, not land, for a Fill that only paints a texture", async () => {
    const storage = mapStorage([areaFill({ texture: "dots" })]);
    const { host } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await selectRow(user, "Fill 1");

      const trigger = await screen.findByRole("button", { name: en["properties.fillColor"] });
      await tabTo(user, trigger, 120);
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog", { name: en["properties.fillColor"] });

      // No flat colour paints the Fill, so its picker shows the host's default
      // instead of claiming the Fill is painted land.
      expect(within(dialog).getByRole("textbox")).toHaveValue("#000000");

      await page.unmount();
    } finally {
      await host.stop();
    }
  });
});
