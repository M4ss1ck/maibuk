import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "app.title": "Maibuk",
        "common.projects": "Projects",
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

import { Layout } from "../../components/Layout";
import { APP_VERSION } from "../../constants";
import { useThemeStore } from "../../features/theme/store";

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

  it("displays the app version in the sidebar", () => {
    renderLayout();
    expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
  });

  it("opens mobile menu on hamburger click", async () => {
    const user = userEvent.setup();
    renderLayout();

    const menuButton = screen.getByLabelText("Open menu");
    await user.click(menuButton);

    // Close button should now be visible
    expect(screen.getByLabelText("Close menu")).toBeInTheDocument();
  });
});
