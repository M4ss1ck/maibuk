import { beforeEach, describe, expect, it } from "vitest";
import { useCommandPaletteStore } from "@/features/command-palette/store";

beforeEach(() => {
  useCommandPaletteStore.setState({ isOpen: false });
});

describe("useCommandPaletteStore", () => {
  it("starts closed", () => {
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });

  it("opens and closes", () => {
    useCommandPaletteStore.getState().open();
    expect(useCommandPaletteStore.getState().isOpen).toBe(true);
    useCommandPaletteStore.getState().close();
    expect(useCommandPaletteStore.getState().isOpen).toBe(false);
  });
});
