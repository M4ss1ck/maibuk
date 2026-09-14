import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShortcutsHelpDialog } from "@/components/ShortcutsHelpDialog";
import { useModalStore } from "@/components/ui/modal-store";
import { useBoundShortcutIds } from "@/lib/bound-shortcuts";
import type { ShortcutId } from "@/lib/shortcut-registry";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/platform", () => ({ isMac: () => false, IS_ANDROID: false }));

function Screen({ bound }: { bound: ShortcutId[] }) {
  useBoundShortcutIds(bound);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Show shortcuts
      </button>
      <ShortcutsHelpDialog isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}

async function openHelp(bound: ShortcutId[]) {
  const user = userEvent.setup();
  render(<Screen bound={bound} />);
  await user.tab();
  expect(screen.getByRole("button", { name: "Show shortcuts" })).toHaveFocus();
  await user.keyboard("{Enter}");
  return { user, dialog: await screen.findByRole("dialog") };
}

describe("ShortcutsHelpDialog", () => {
  beforeEach(() => {
    useModalStore.setState({ modalIds: [], openCount: 0 });
  });

  it("lists what works on this screen first, then the rest by area", async () => {
    const { dialog } = await openHelp(["global.showHelp", "editor.save"]);

    const thisScreen = within(dialog).getByRole("region", { name: "shortcuts.onThisScreen" });
    const everywhere = within(thisScreen).getByRole("region", { name: "shortcuts.areaGlobal" });
    expect(within(everywhere).getByText("shortcuts.showHelp")).toBeInTheDocument();
    const editorHere = within(thisScreen).getByRole("region", { name: "shortcuts.areaEditor" });
    expect(within(editorHere).getByText("shortcuts.save")).toBeInTheDocument();
    expect(within(thisScreen).queryByText("shortcuts.newBook")).not.toBeInTheDocument();

    const otherScreens = within(dialog).getByRole("region", { name: "shortcuts.onOtherScreens" });
    const books = within(otherScreens).getByRole("region", { name: "shortcuts.areaHome" });
    expect(within(books).getByText("shortcuts.newBook")).toBeInTheDocument();
    const editor = within(otherScreens).getByRole("region", { name: "shortcuts.areaEditor" });
    // Bound here, so not repeated under other screens.
    expect(within(editor).queryByText("shortcuts.save")).not.toBeInTheDocument();
    expect(within(editor).getByText("shortcuts.saveVersion")).toBeInTheDocument();
  });

  it("never lists an unbound global shortcut as belonging to another screen", async () => {
    const { dialog } = await openHelp(["global.showHelp"]);

    const otherScreens = within(dialog).getByRole("region", { name: "shortcuts.onOtherScreens" });
    expect(within(otherScreens).queryByText("shortcuts.toggleAlwaysOnTop")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("shortcuts.toggleAlwaysOnTop")).not.toBeInTheDocument();
  });

  it("says so when nothing is bound on this screen", async () => {
    const { dialog } = await openHelp([]);

    const thisScreen = within(dialog).getByRole("region", { name: "shortcuts.onThisScreen" });
    expect(within(thisScreen).getByText("shortcuts.none")).toBeInTheDocument();
  });

  it("closes with Escape and returns focus to the button that opened it", async () => {
    const { user } = await openHelp(["global.showHelp"]);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show shortcuts" })).toHaveFocus();
  });
});
