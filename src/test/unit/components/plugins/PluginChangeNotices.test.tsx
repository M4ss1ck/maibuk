/**
 * The Plugin changed-files notice (#442). The management store lists the
 * changed copies (and Built-in updates); the notice renders each with the two
 * actions a toast cannot hold. These prove Review navigates to Settings >
 * Plugins and asks for the Plugin's review dialog, and Dismiss clears the
 * notification — both by keyboard.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import "@/i18n";
import { PluginChangeNotices } from "@/components/plugins/PluginChangeNotices";
import { usePluginManagementStore } from "@/features/plugins/management";
import { useSettingsRevealStore } from "@/features/settings/settings-reveal-store";

type User = ReturnType<typeof userEvent.setup>;

let path = "/";
function LocationProbe() {
  path = useLocation().pathname;
  return null;
}

function renderNotices() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <PluginChangeNotices />
      <LocationProbe />
    </MemoryRouter>
  );
}

function seedChanged(): void {
  usePluginManagementStore.setState({
    notifications: [{ pluginId: "echoes", name: "Echoes", hash: "h1:x", kind: "changed" }],
  });
}

async function tabTo(user: User, target: HTMLElement, max = 12): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (document.activeElement === target) return;
    await user.tab();
  }
  expect(document.activeElement).toBe(target);
}

beforeEach(() => {
  path = "/";
  localStorage.clear();
  usePluginManagementStore.setState({ notifications: [] });
  useSettingsRevealStore.setState({ pendingPluginReviewId: null });
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("PluginChangeNotices", () => {
  it("renders no notice when nothing changed", () => {
    renderNotices();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names the changed Plugin", () => {
    seedChanged();
    renderNotices();
    expect(screen.getByText("Echoes was disabled because its files changed.")).toBeInTheDocument();
  });

  it("opens the review from Settings > Plugins by keyboard", async () => {
    const user = userEvent.setup();
    seedChanged();
    renderNotices();

    const review = screen.getByRole("button", { name: "Review" });
    await tabTo(user, review);
    await user.keyboard("{Enter}");

    await waitFor(() => expect(path).toBe("/settings"));
    expect(useSettingsRevealStore.getState().pendingPluginReviewId).toBe("echoes");
    // Review clears the notice; the dialog takes over.
    expect(usePluginManagementStore.getState().notifications).toEqual([]);
  });

  it("dismisses the notice by keyboard", async () => {
    const user = userEvent.setup();
    seedChanged();
    renderNotices();

    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    await tabTo(user, dismiss);
    await user.keyboard("{Enter}");

    await waitFor(() => expect(usePluginManagementStore.getState().notifications).toEqual([]));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
