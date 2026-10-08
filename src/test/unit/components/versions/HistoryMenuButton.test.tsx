import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { HistoryMenuButton } from "@/components/versions/HistoryMenuButton";
import { installPointerEvent } from "@/test/support/pointer-events";

beforeAll(installPointerEvent);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "common.more": "More",
        "versions.openHistory": "Open version history",
        "versions.saveVersion": "Save version",
        "versions.showHistory": "Show history",
        "versions.title": "Version history",
      };
      return map[key] ?? key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

function renderButton() {
  const onOpenPanel = vi.fn();
  const onSaveVersion = vi.fn();

  render(
    <>
      <HistoryMenuButton
        onOpenPanel={onOpenPanel}
        onSaveVersion={onSaveVersion}
        saveVersionShortcut="Ctrl+Alt+S"
        panelShortcut="g v"
      />
      <button type="button">Outside</button>
    </>
  );

  return { onOpenPanel, onSaveVersion };
}

describe("HistoryMenuButton", () => {
  it("calls only onOpenPanel when the primary button is clicked", async () => {
    const user = userEvent.setup();
    const { onOpenPanel, onSaveVersion } = renderButton();

    await user.click(screen.getByRole("button", { name: "Open version history" }));

    expect(onOpenPanel).toHaveBeenCalledTimes(1);
    expect(onSaveVersion).not.toHaveBeenCalled();
  });

  it("toggles the menu from the caret button", async () => {
    const user = userEvent.setup();
    renderButton();

    // The open menu is modal and hides the rest of the page from the
    // accessibility tree, so hold the trigger from before it opens.
    const trigger = screen.getByRole("button", { name: "More" });
    await user.click(trigger);
    expect(await screen.findByRole("menu")).toBeInTheDocument();

    await user.click(trigger);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("saves a version from the menu and closes it", async () => {
    const user = userEvent.setup();
    const { onOpenPanel, onSaveVersion } = renderButton();

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: /Save version/ }));

    expect(onSaveVersion).toHaveBeenCalledTimes(1);
    expect(onOpenPanel).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens history from the menu and closes it", async () => {
    const user = userEvent.setup();
    const { onOpenPanel, onSaveVersion } = renderButton();

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: /Show history/ }));

    expect(onOpenPanel).toHaveBeenCalledTimes(1);
    expect(onSaveVersion).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the menu on Escape", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("restores focus to the trigger button when Escape closes the menu", async () => {
    const user = userEvent.setup();
    renderButton();

    const trigger = screen.getByRole("button", { name: "More" });
    await user.click(trigger);
    const saveItem = await screen.findByRole("menuitem", { name: /Save version/ });
    // The Menu focuses its first item a frame after it opens.
    await waitFor(() => expect(saveItem).toHaveFocus());

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes the menu when clicking outside", async () => {
    const user = userEvent.setup();
    renderButton();

    const outside = screen.getByRole("button", { name: "Outside" });
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    await user.click(outside);

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("opens the menu and focuses the first item from ArrowDown on the trigger", async () => {
    const user = userEvent.setup();
    renderButton();

    // The primary "Open version history" button comes first, then the menu trigger.
    await user.tab();
    await user.tab();
    await user.keyboard("{ArrowDown}");

    const saveItem = screen.getByRole("menuitem", { name: /Save version/ });
    await waitFor(() => expect(saveItem).toHaveFocus());
  });

  it("opens the menu and focuses the first item from Enter on the trigger", async () => {
    const user = userEvent.setup();
    renderButton();

    screen.getByRole("button", { name: "More" }).focus();
    await user.keyboard("{Enter}");

    const saveItem = screen.getByRole("menuitem", { name: /Save version/ });
    await waitFor(() => expect(saveItem).toHaveFocus());
  });

  it("moves focus between menu items with arrow keys", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: "More" }));
    const saveItem = screen.getByRole("menuitem", { name: /Save version/ });
    const historyItem = screen.getByRole("menuitem", { name: /Show history/ });
    saveItem.focus();

    await user.keyboard("{ArrowDown}");
    expect(historyItem).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(saveItem).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(historyItem).toHaveFocus();
  });

  it("closes the menu from a menu item with Escape and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    renderButton();

    const trigger = screen.getByRole("button", { name: "More" });
    trigger.focus();
    await user.keyboard("{Enter}");
    // The Menu focuses its first item a frame after it opens; Escape must come
    // from that item, not from the trigger.
    const saveItem = await screen.findByRole("menuitem", { name: /Save version/ });
    await waitFor(() => expect(saveItem).toHaveFocus());
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
