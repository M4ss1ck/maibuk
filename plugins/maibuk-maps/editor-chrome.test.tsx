import { type ReactElement } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import en from "./locales/runtime/en.json";
import { format } from "./i18n";
import { MAP_PAGE_ID } from "./runtime";
import {
  mapStorage,
  openEditor,
  selectRow,
  chooseRowMenu,
  tabTo,
  pickTool,
  openLayers,
  closeLayers,
} from "./test-support";

// A focused button opens its Tooltip, and Floating UI then reads computed
// style up the whole ancestor chain: in jsdom that was 38% of a keyboard
// test's time (#850). No test here asserts a Tooltip, so it renders its child.
vi.mock("@/components/ui/Tooltip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/Tooltip")>()),
  Tooltip: ({ children }: { children: ReactElement }) => children,
}));

describe("the floating editor's chrome (#778)", () => {
  // The chrome's keyboard paths, one test each: walked in one test they took
  // most of its timeout on a loaded CI shard.
  it("picks a belt tool and opens the Layers card by keyboard", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      // A tool from the belt: one press picks it, and the belt says so.
      await pickTool(user, en["tools.pencil"]);
      expect(runtime.editor?.getSnapshot().tool).toBe("pencil");

      // The Layers card starts shut, and its toggle is the way in.
      expect(screen.queryByRole("list")).toBeNull();
      await openLayers(user);
      expect(await screen.findByRole("list")).toBeInTheDocument();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("places a Stamp from Insert, deletes it from a Layers row, and shuts Layers by keyboard", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      // Insert's card places a Stamp at the view centre by keyboard.
      await pickTool(user, en["tools.insert"]);
      const place = await screen.findByRole("button", {
        name: format(en["properties.placeStamp"], { stamp: en["stamp.capital"] }),
      });
      await tabTo(user, place, 120);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(runtime.editor?.getSnapshot().elements).toHaveLength(1));
      expect(runtime.editor?.getSnapshot().elements[0]).toMatchObject({
        kind: "stamp",
        name: en["stamp.capital"],
        transform: { x: 76.2, y: 114.3 },
      });

      // The Layers row menu deletes it again.
      await selectRow(user, en["stamp.capital"]);
      await chooseRowMenu(user, en["elements.delete"]);
      await waitFor(() => expect(runtime.editor?.getSnapshot().elements).toEqual([]));

      // The toggle shuts the card again, and the list leaves the page with it.
      await closeLayers(user);
      await waitFor(() => expect(screen.queryByRole("list")).toBeNull());

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("minimises Properties to one icon and restores it by keyboard", async () => {
    const storage = mapStorage([]);
    const { host } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      // Properties minimises to one icon, and comes back.
      await pickTool(user, en["tools.pen"]);
      const minimise = await screen.findByRole("button", {
        name: en["chrome.minimiseProperties"],
      });
      await tabTo(user, minimise, 120);
      await user.keyboard("{Enter}");
      const restore = await screen.findByRole("button", { name: en["chrome.restoreProperties"] });
      // One icon is all the card keeps while it is minimised.
      expect(screen.queryByLabelText(en["properties.lineStyle"])).toBeNull();
      await tabTo(user, restore, 120);
      await user.keyboard("{Enter}");
      expect(
        await screen.findByRole("button", { name: en["chrome.minimiseProperties"] })
      ).toBeInTheDocument();
      // The controls are back: the Pen's line style is the card's first one.
      expect(await screen.findByLabelText(en["properties.lineStyle"])).toBeInTheDocument();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });
});
