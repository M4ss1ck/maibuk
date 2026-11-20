import { type ReactElement } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import en from "./locales/runtime/en.json";
import { format } from "./i18n";
import { MAP_PAGE_ID } from "./runtime";
import {
  line,
  mapStorage,
  storedMap,
  openEditor,
  selectRow,
  tabTo,
  openLayers,
  closeLayers,
  openExport,
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
  it("draws each Elements list row as its name over its kind, with Locked and no Hidden in words", async () => {
    const storage = mapStorage([
      {
        ...line("e1", "Etiqueta de Pinar del Río", [
          [10, 10],
          [20, 20],
        ]),
        hidden: true,
        locked: true,
      },
    ]);
    const { host } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await openLayers(user);
      const row = await within(await screen.findByRole("list")).findByRole("button", {
        name: /^Etiqueta de Pinar del Río/,
      });
      const [name, kind] = Array.from(row.children);
      expect(name).toHaveTextContent(/^Etiqueta de Pinar del Río$/);
      expect(kind).toHaveTextContent(`${en["element.kind.line"]} · ${en["elements.locked"]}`);
      expect(row).not.toHaveTextContent(/Hidden/);
      // Hidden reads off the row's own eye, pressed.
      expect(
        screen.getByRole("button", {
          name: format(en["elements.hideFor"], { name: "Etiqueta de Pinar del Río" }),
        })
      ).toHaveAttribute("aria-pressed", "true");

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("says the Layers card is empty when the Map holds no Elements", async () => {
    const storage = mapStorage([]);
    const { host } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      await openLayers(userEvent.setup({ delay: null }));
      expect(await screen.findByText(en["elements.empty"])).toBeInTheDocument();
      expect(screen.queryByRole("listitem")).toBeNull();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("hides and shows an Element from its row's eye, and shuts Layers from its header, by keyboard", async () => {
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
      await openLayers(user);
      const eye = await screen.findByRole("button", {
        name: format(en["elements.hideFor"], { name: "Line one" }),
      });
      expect(eye).toHaveAttribute("aria-pressed", "false");
      await tabTo(user, eye, 300);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(eye).toHaveAttribute("aria-pressed", "true"));
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0].hidden).toBe(true);
      // The eye hides without selecting: the row stays a plain row.
      expect(runtime.editor?.getSnapshot().selectedId).toBeNull();

      await user.keyboard("{Enter}");
      await waitFor(() => expect(eye).toHaveAttribute("aria-pressed", "false"));
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0].hidden).toBe(false);

      const close = screen.getByRole("button", { name: en["chrome.closeLayers"] });
      await tabTo(user, close, 300);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(screen.queryByRole("list")).toBeNull());
      expect(screen.getByRole("button", { name: en["chrome.layers"] })).toHaveAttribute(
        "aria-pressed",
        "false"
      );

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("toggles Hidden and Locked from the Properties header by keyboard", async () => {
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
      await closeLayers(user);
      for (const [key, field] of [
        ["properties.hidden", "hidden"],
        ["properties.locked", "locked"],
      ] as const) {
        const toggle = screen.getByRole("button", { name: en[key] });
        expect(toggle).toHaveAttribute("aria-pressed", "false");
        await tabTo(user, toggle, 300);
        await user.keyboard(" ");
        await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));
        await runtime.editor?.flush();
        expect(storedMap(storage).elements[0][field]).toBe(true);
      }

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("zooms in from the cluster and resets from its readout by keyboard", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      // The zoom cluster: Zoom in moves the view, and the readout resets it.
      const zoomIn = await screen.findByRole("button", { name: en["chrome.zoomIn"] });
      await tabTo(user, zoomIn, 120);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(runtime.editor?.getSnapshot().zoom).toBeCloseTo(1.25, 10));
      const readout = await screen.findByRole("button", {
        name: format(en["chrome.zoom"], { percent: 125 }),
      });
      await tabTo(user, readout, 120);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(runtime.editor?.getSnapshot().zoom).toBe(1));

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("opens the Export popover by keyboard", async () => {
    const storage = mapStorage([]);
    const { host } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      // Export opens its popover, which holds the Save path.
      await openExport(user);
      expect(screen.getByRole("button", { name: en["export.save"] })).toBeInTheDocument();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });
});
