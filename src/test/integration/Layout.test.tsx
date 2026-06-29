import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "app.title": "Maibuk",
        "common.projects": "Projects",
        "common.metrics": "Metrics",
        "common.settings": "Settings",
        "settings.light": "Light",
        "settings.dark": "Dark",
        "settings.system": "System",
      };
      return map[key] ?? key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { Layout } from "@/components/Layout";
import { APP_VERSION } from "@/constants";
import { useThemeStore } from "@/features/theme/store";
import { useSettingsStore } from "@/features/settings/store";

describe("Layout", () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.setState({ theme: "system" });
    document.documentElement.classList.remove("dark");
  });

  function renderLayout(route = "/") {
    return render(
      <MemoryRouter initialEntries={[route]}>
        <Layout />
      </MemoryRouter>
    );
  }

  it("renders the app title in the sidebar", () => {
    renderLayout();
    // Title appears in both mobile header and sidebar
    const titles = screen.getAllByText("Maibuk");
    expect(titles.length).toBeGreaterThan(0);
  });

  it("renders Projects navigation link", () => {
    renderLayout();
    const links = screen.getAllByText("Projects");
    expect(links.length).toBeGreaterThan(0);
  });

  it("renders Settings navigation link", () => {
    renderLayout();
    const links = screen.getAllByText("Settings");
    expect(links.length).toBeGreaterThan(0);
  });

  it("renders Metrics navigation link", () => {
    renderLayout();
    const links = screen.getAllByText("Metrics");
    expect(links.length).toBeGreaterThan(0);
  });

  it("displays the app version in the sidebar", () => {
    renderLayout();
    expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
  });

  it("opens mobile menu on hamburger click", async () => {
    const user = userEvent.setup();
    renderLayout();

    const menuButton = screen.getByLabelText("Open menu");
    await user.click(menuButton);

    // Backdrop + sidebar close button both render when the menu is open
    expect(screen.getAllByLabelText("Close menu")).toHaveLength(2);
  });

  it("closes the mobile menu when Escape is pressed", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByLabelText("Open menu"));
    expect(screen.getAllByLabelText("Close menu")).toHaveLength(2);

    fireEvent.keyDown(window, { key: "Escape" });

    // The backdrop overlay disappears; only the always-present sidebar
    // close button remains.
    expect(screen.getAllByLabelText("Close menu")).toHaveLength(1);
  });

  it("closes the mobile menu when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByLabelText("Open menu"));
    // First "Close menu" element is the backdrop overlay button.
    await user.click(screen.getAllByLabelText("Close menu")[0]);

    expect(screen.getAllByLabelText("Close menu")).toHaveLength(1);
  });

  it("resizes the sidebar via the drag handle", () => {
    useSettingsStore.setState({ mainSidebarWidth: 280 });
    const { container } = renderLayout();

    const handle = container.querySelector(".cursor-col-resize");
    expect(handle).not.toBeNull();

    // Drag right by 50px: 280 -> 330, within the [200, 480] clamp.
    fireEvent.mouseDown(handle as Element, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 150 });
    expect(useSettingsStore.getState().mainSidebarWidth).toBe(330);

    // Beyond the clamp ceiling stays at 480.
    fireEvent.mouseMove(document, { clientX: 1000 });
    expect(useSettingsStore.getState().mainSidebarWidth).toBe(480);

    fireEvent.mouseUp(document);

    // After mouseup the drag is released: further movement is ignored.
    fireEvent.mouseMove(document, { clientX: 100 });
    expect(useSettingsStore.getState().mainSidebarWidth).toBe(480);
  });
});
