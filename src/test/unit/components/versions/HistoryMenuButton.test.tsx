import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HistoryMenuButton } from "../../../../components/versions/HistoryMenuButton";

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

    await user.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
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

  it("closes the menu when clicking outside", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("button", { name: "Outside" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens the menu and focuses the first item from ArrowDown", async () => {
    const user = userEvent.setup();
    renderButton();
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        window.setTimeout(() => callback(0), 0);
        return 1;
      });

    await user.tab();
    await user.keyboard("{ArrowDown}");

    const saveItem = screen.getByRole("menuitem", { name: /Save version/ });
    await waitFor(() => expect(saveItem).toHaveFocus());

    requestAnimationFrame.mockRestore();
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

  it("closes the menu from a menu item with Escape", async () => {
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: "More" }));
    screen.getByRole("menuitem", { name: /Save version/ }).focus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
