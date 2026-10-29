import { afterEach, describe, expect, it } from "vitest";
import { restoreOpenerFocus } from "@/components/command-palette/CommandPalette";
import { useCommandPaletteStore } from "@/features/command-palette/store";

function mountButton(): HTMLButtonElement {
  const button = document.createElement("button");
  document.body.append(button);
  return button;
}

afterEach(() => {
  document.body.replaceChildren();
  useCommandPaletteStore.setState({ isOpen: false, opener: null });
});

describe("restoreOpenerFocus()", () => {
  it("hands focus back to the opener once the palette is closed", () => {
    const opener = mountButton();
    restoreOpenerFocus(opener);
    expect(opener).toHaveFocus();
  });

  it("leaves focus in a palette that reopened before the chosen Command ran", () => {
    const opener = mountButton();
    const search = mountButton();
    search.focus();
    useCommandPaletteStore.setState({ isOpen: true });

    restoreOpenerFocus(opener);

    expect(search).toHaveFocus();
  });

  it("does nothing for an opener that left the document", () => {
    const opener = document.createElement("button");
    const other = mountButton();
    other.focus();

    restoreOpenerFocus(opener);

    expect(other).toHaveFocus();
  });
});
