import { type ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SOFT_EDGE_MM, SOFT_EDGE_STEP_MM } from "./editor";
import en from "./locales/runtime/en.json";
import { DEFAULT_FILL_COLOR, DEFAULT_LABEL_FONT, newLabel, type MapLabelElement } from "./maps";
import { MAP_PAGE_ID } from "./runtime";
import { DEFAULT_SCATTER_SPACING_MM } from "./scatter";
import {
  frameHostFor,
  line,
  areaFill,
  mapStorage,
  storedMap,
  registerMapCommands,
  CommandKeys,
  openEditor,
  elementsList,
  selectRow,
  focusPanelButton,
  tabTo,
  backToRows,
  fillNow,
  lineNow,
  storedFill,
  storedLine,
  pickTool,
  openLayers,
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
  it("adds a Map Label at the view centre by keyboard, then writes, fonts, and bends it", async () => {
    const storage = mapStorage([]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    registerMapCommands();
    const keys = render(<CommandKeys host={host} />);
    try {
      const user = userEvent.setup({ delay: null });

      // The Text tool's Properties offer the keyboard path that lands a Map
      // Label at the view centre.
      await pickTool(user, en["tools.text"]);
      expect(runtime.editor?.getSnapshot().tool).toBe("text");
      const place = await screen.findByRole("button", { name: en["properties.mapLabel.place"] });
      await tabTo(user, place, 120);
      await user.keyboard("{Enter}");

      // A Map Label at the centre of the portrait page, with empty text the
      // placeholder stands in for (#798), and selected.
      await waitFor(() => expect(runtime.editor?.getSnapshot().elements).toHaveLength(1));
      const inserted = runtime.editor?.getSnapshot().elements[0] as MapLabelElement;
      expect(inserted).toMatchObject({
        kind: "label",
        name: "Map Label 1",
        text: "",
        x: 76.2,
        y: 114.3,
        rotation: 0,
        font: DEFAULT_LABEL_FONT,
        bend: 0,
      });
      expect(runtime.editor?.getSnapshot().selectedId).toBe(inserted.id);
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0]).toMatchObject({ x: 76.2, y: 114.3 });

      // The Elements list calls the row a Map Label.
      await openLayers(user);
      await waitFor(() => expect(elementsList()).toHaveTextContent(en["element.kind.label"]));

      // One arrow moves the selected label one page millimetre.
      await focusPanelButton(user);
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLabelElement).x).toBe(77.2)
      );

      // The Text field starts empty and shows the prompt as its placeholder, so
      // the first key typed is the label's text (#798).
      const text = await screen.findByRole("textbox", { name: en["properties.mapLabel.text"] });
      expect(text).toHaveValue("");
      expect(text).toHaveAttribute("placeholder", en["element.labelPlaceholder"]);
      await tabTo(user, text, 120);
      await user.keyboard("Northern Reach{Enter}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLabelElement).text).toBe(
          "Northern Reach"
        )
      );
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0]).toMatchObject({ text: "Northern Reach" });

      // Clearing the field clears the label, and the placeholder comes back.
      await user.keyboard("{Control>}a{/Control}{Backspace}{Enter}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLabelElement).text).toBe("")
      );
      expect(text).toHaveValue("");
      expect(text).toHaveAttribute("placeholder", en["element.labelPlaceholder"]);
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0]).toMatchObject({ text: "" });

      await user.keyboard("Northern Reach{Enter}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLabelElement).text).toBe(
          "Northern Reach"
        )
      );

      // The Font select offers the bundled faces by family name.
      await pickOption(user, en["properties.mapLabel.font"], "Cinzel");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLabelElement).font).toBe("cinzel")
      );
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0]).toMatchObject({ font: "cinzel" });

      // Bend curves the baseline; 0 draws it straight.
      const bend = await screen.findByRole("textbox", { name: en["properties.mapLabel.bend"] });
      await tabTo(user, bend, 120);
      await user.keyboard("{Control>}a{/Control}5{Enter}");
      await waitFor(() =>
        expect((runtime.editor?.getSnapshot().elements[0] as MapLabelElement).bend).toBe(5)
      );
      await runtime.editor?.flush();
      expect(storedMap(storage).elements[0]).toMatchObject({ bend: 5 });

      keys.unmount();
      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("names an installed PDF Font in the Font select, and says when none is installed", async () => {
    const storageLabel = () =>
      newLabel({
        id: "l1",
        name: "Map Label 1",
        text: "Label",
        point: [76.2, 114.3],
        font: "pdf",
      });

    const installed = frameHostFor(mapStorage([storageLabel()]), [
      { id: "latin", family: "Noto Serif", bytes: new TextEncoder().encode("FONT") },
    ]);
    try {
      expect(await installed.runtime.openMap("m1")).toBe(true);
      installed.runtime.editor?.select("l1");
      const page = await installed.host.renderPage(MAP_PAGE_ID);
      const font = await screen.findByLabelText(en["properties.mapLabel.font"]);
      await waitFor(() => expect(font).toHaveTextContent("PDF Font (Noto Serif)"));
      await page.unmount();
    } finally {
      await installed.host.stop();
    }

    const missing = frameHostFor(mapStorage([storageLabel()]));
    try {
      expect(await missing.runtime.openMap("m1")).toBe(true);
      missing.runtime.editor?.select("l1");
      const page = await missing.host.renderPage(MAP_PAGE_ID);
      const font = await screen.findByLabelText(en["properties.mapLabel.font"]);
      await waitFor(() => expect(font).toHaveTextContent(en["font.pdfNotInstalled"]));
      await page.unmount();
    } finally {
      await missing.host.stop();
    }
  });

  it("turns Soft Edge on a Fill and a Map Line by keyboard, and fades it further with the arrows", async () => {
    const storage = mapStorage([
      areaFill({ color: DEFAULT_FILL_COLOR }),
      line(
        "ring",
        "Ring",
        [
          [20, 20],
          [70, 20],
          [70, 70],
        ],
        { closed: true, curves: [false, false, false] }
      ),
    ]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await selectRow(user, "Fill 1");

      const toggle = await screen.findByRole("switch", { name: en["properties.softEdge"] });
      await tabTo(user, toggle, 120);
      expect(toggle).toHaveFocus();
      await user.keyboard(" ");
      await waitFor(() => expect(fillNow(runtime).softEdge).toBe(DEFAULT_SOFT_EDGE_MM));

      const amount = await screen.findByRole("slider", { name: en["properties.softEdgeAmount"] });
      await tabTo(user, amount, 120);
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect(fillNow(runtime).softEdge).toBe(DEFAULT_SOFT_EDGE_MM + SOFT_EDGE_STEP_MM)
      );
      await runtime.editor?.flush();
      expect(storedFill(storage).softEdge).toBe(DEFAULT_SOFT_EDGE_MM + SOFT_EDGE_STEP_MM);

      // A Map Line takes the same two controls, and its own amount: the panel
      // shows the Line's value, not the one the Fill left behind.
      await backToRows(user);
      await selectRow(user, "Ring");
      const lineToggle = await screen.findByRole("switch", { name: en["properties.softEdge"] });
      await tabTo(user, lineToggle, 120);
      await user.keyboard(" ");
      await waitFor(() => expect(lineNow(runtime).softEdge).toBe(DEFAULT_SOFT_EDGE_MM));

      const lineAmount = await screen.findByRole("slider", {
        name: en["properties.softEdgeAmount"],
      });
      await tabTo(user, lineAmount, 120);
      expect(lineAmount).toHaveFocus();
      // The Line's amount is its own: one step down lands on 1.5, not on the
      // 2 the Fill's slider had moved to.
      await user.keyboard("{ArrowLeft}");
      await waitFor(() =>
        expect(lineNow(runtime).softEdge).toBe(DEFAULT_SOFT_EDGE_MM - SOFT_EDGE_STEP_MM)
      );
      await runtime.editor?.flush();
      expect(storedLine(storage).softEdge).toBe(DEFAULT_SOFT_EDGE_MM - SOFT_EDGE_STEP_MM);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("picks a texture and a scatter by keyboard, respaces and reseeds it, and clears one kind", async () => {
    const storage = mapStorage([areaFill({ color: DEFAULT_FILL_COLOR })]);
    const { host, runtime } = await openEditor(storage);
    const page = await host.renderPage(MAP_PAGE_ID);
    try {
      const user = userEvent.setup({ delay: null });
      await selectRow(user, "Fill 1");

      await pickOption(user, en["properties.fillTexture"], en["properties.texture.grass"]);
      await waitFor(() => expect(fillNow(runtime).content.texture).toBe("grass"));

      // A Fill that first takes a scatter picks a Stamp from the base picker and
      // starts from a fresh seed.
      await pickOption(user, en["properties.fillScatter"], en["stamp.castle"]);
      await waitFor(() => expect(fillNow(runtime).content.scatter?.stamp).toBe("base:castle"));
      const firstSeed = fillNow(runtime).content.scatter?.seed ?? 0;
      expect(firstSeed).toBeGreaterThan(0);
      expect(fillNow(runtime).content.scatter?.spacing).toBe(DEFAULT_SCATTER_SPACING_MM);

      const spacing = await screen.findByRole("slider", { name: en["properties.scatterSpacing"] });
      await tabTo(user, spacing, 120);
      await user.keyboard("{ArrowRight}");
      await waitFor(() =>
        expect(fillNow(runtime).content.scatter?.spacing).toBe(DEFAULT_SCATTER_SPACING_MM + 1)
      );
      expect(fillNow(runtime).content.scatter?.seed).toBe(firstSeed);

      // Reseed keeps the Stamp and the spacing, and moves the Stamps.
      const reseed = await screen.findByRole("button", { name: en["properties.reseed"] });
      await tabTo(user, reseed, 120);
      await user.keyboard("{Enter}");
      await waitFor(() => expect(fillNow(runtime).content.scatter?.seed).not.toBe(firstSeed));

      // The colour and the scatter still cover the Fill, so the texture may go.
      await backToRows(user);
      await pickOption(user, en["properties.fillTexture"], en["properties.none"]);
      await waitFor(() => expect(fillNow(runtime).content.texture).toBeUndefined());
      await runtime.editor?.flush();
      expect(storedFill(storage).content).toMatchObject({
        color: "land",
        scatter: { stamp: "base:castle" },
      });
      expect(storedFill(storage).content.texture).toBeUndefined();

      await page.unmount();
    } finally {
      await host.stop();
    }
  });
});
