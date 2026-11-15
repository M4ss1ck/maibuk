import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  onLabelChange: vi.fn(),
  onLabelCommit: vi.fn(),
  onDirectedChange: vi.fn(),
  onStyleChange: vi.fn(),
  onColorPreview: vi.fn(),
  onDelete: vi.fn(),
  onClose: vi.fn(),
}));

// The real strings: the controls' accessible names are part of what is asserted.
vi.mock("react-i18next", async (importOriginal) => {
  const { default: en } = await import("@/locales/en.json");
  const lookup = (key: string): unknown =>
    key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
        en
      );
  return {
    ...(await importOriginal<typeof import("react-i18next")>()),
    useTranslation: () => ({ t: (key: string) => lookup(key) ?? key }),
  };
});

const { EdgeInspectorCard } = await import("@/features/canvas/EdgeInspectorCard");

function renderCard(
  edge: { width?: 1 | 2 | 4 | 6; lineStyle?: "solid" | "dashed" | "dotted" } = {}
) {
  render(
    <EdgeInspectorCard
      edge={{ id: "edge", source: "a", target: "b", ...edge }}
      labelDraft=""
      onLabelChange={mocks.onLabelChange}
      onLabelCommit={mocks.onLabelCommit}
      onDirectedChange={mocks.onDirectedChange}
      onStyleChange={mocks.onStyleChange}
      onColorPreview={mocks.onColorPreview}
      onDelete={mocks.onDelete}
      onClose={mocks.onClose}
    />
  );
}

function thicknessOption(name: string) {
  return within(screen.getByRole("radiogroup", { name: "Connection thickness" })).getByRole(
    "radio",
    { name }
  );
}

function lineStyleOption(name: string) {
  return within(screen.getByRole("radiogroup", { name: "Line style" })).getByRole("radio", {
    name,
  });
}

describe("EdgeInspectorCard style controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("thickens the connection with ArrowRight from the checked thickness", async () => {
    const user = userEvent.setup();
    renderCard();

    const thin = thicknessOption("Thin");
    expect(thin).toBeChecked();
    thin.focus();
    await user.keyboard("{ArrowRight}");

    expect(mocks.onStyleChange).toHaveBeenLastCalledWith({ width: 2 });
  });

  it("dashes the connection with ArrowRight from Solid", async () => {
    const user = userEvent.setup();
    renderCard();

    const solid = lineStyleOption("Solid");
    expect(solid).toBeChecked();
    solid.focus();
    await user.keyboard("{ArrowRight}");

    expect(mocks.onStyleChange).toHaveBeenLastCalledWith({ lineStyle: "dashed" });
  });

  it("shows the stored thickness and line style as the checked options", () => {
    renderCard({ width: 4, lineStyle: "dotted" });

    expect(thicknessOption("Thick")).toBeChecked();
    expect(lineStyleOption("Dotted")).toBeChecked();
  });

  it("commits a connection color chosen from the keyboard", async () => {
    const user = userEvent.setup();
    renderCard();

    const trigger = screen.getByRole("button", { name: "Connection color" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Connection color" });

    // The first preset is #EF4444; the labels interpolate, so it is picked by
    // its place in the list.
    const swatch = within(dialog).getAllByRole("option")[0];
    swatch.focus();
    await user.keyboard("{Enter}");

    expect(mocks.onStyleChange).toHaveBeenLastCalledWith({ color: "#EF4444" });
  });

  it("still closes the card with Escape", async () => {
    const user = userEvent.setup();
    renderCard();

    thicknessOption("Thin").focus();
    await user.keyboard("{Escape}");

    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });
});
