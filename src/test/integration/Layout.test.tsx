import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const { i18nState } = vi.hoisted(() => ({
  i18nState: { language: "en" },
}));

const translations = {
  en: {
    "app.title": "Maibuk",
    "common.projects": "Projects",
    "common.notes": "Notes",
    "common.canvas": "Canvas",
    "common.metrics": "Metrics",
    "common.settings": "Settings",
    "nav.primary": "Primary navigation",
    "nav.openMenu": "Open navigation menu",
    "nav.closeMenu": "Close navigation menu",
    "panes.navSidebar": "Navigation sidebar",
    "panes.mainContent": "Main content",
    "settings.light": "Light",
    "settings.dark": "Dark",
    "settings.system": "System",
  },
  es: {
    "app.title": "Maibuk",
    "common.projects": "Proyectos",
    "common.notes": "Notas",
    "common.canvas": "Lienzos",
    "common.metrics": "Métricas",
    "common.settings": "Configuración",
    "nav.primary": "Navegación principal",
    "nav.openMenu": "Abrir menú de navegación",
    "nav.closeMenu": "Cerrar menú de navegación",
    "panes.navSidebar": "Barra lateral de navegación",
    "panes.mainContent": "Contenido principal",
    "settings.light": "Claro",
    "settings.dark": "Oscuro",
    "settings.system": "Sistema",
  },
} as const;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { version?: string }) => {
      if (key === "settings.updateAvailable") return `Update ${options?.version}`;
      return (
        translations[i18nState.language as keyof typeof translations][
          key as keyof (typeof translations)["en"]
        ] ?? key
      );
    },
    i18n: { language: i18nState.language, resolvedLanguage: i18nState.language },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/features/version", () => ({
  useVersionCheck: () => ({ latestVersion: "v99.0.0", isOutdated: true }),
}));

import { Layout } from "@/components/Layout";
import { APP_VERSION, DOWNLOAD_PAGE } from "@/constants";
import { useThemeStore } from "@/features/theme/store";
import { useSettingsStore } from "@/features/settings/store";
import { runTopBackDismiss } from "@/lib/platform/backDismiss";

function RouteFixture() {
  const { pathname } = useLocation();

  return (
    <>
      <output data-testid="current-route">{pathname}</output>
      <button type="button">Background action</button>
    </>
  );
}

describe("Layout", () => {
  beforeEach(() => {
    localStorage.clear();
    i18nState.language = "en";
    useThemeStore.setState({ theme: "system" });
    useSettingsStore.setState({ mainSidebarWidth: 280 });
    document.documentElement.classList.remove("dark");
  });

  function renderLayout(route = "/") {
    return render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<RouteFixture />} />
            <Route path="*" element={<RouteFixture />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
  }

  function getNavigation() {
    return screen.getByRole("navigation", { name: translations.en["nav.primary"] });
  }

  function getNavigationLink(name: string) {
    const link = within(getNavigation()).getByText(name).closest("a");
    expect(link).not.toBeNull();
    return link as HTMLAnchorElement;
  }

  it("renders the app title and primary navigation links and brand is visible but not an h1", () => {
    renderLayout();

    expect(screen.getAllByText("Maibuk").length).toBeGreaterThan(0);
    for (const el of screen.getAllByText("Maibuk")) {
      expect(el.tagName).not.toBe("H1");
    }
    expect(getNavigationLink("Projects")).toHaveAttribute("href", "/");
    expect(getNavigationLink("Metrics")).toHaveAttribute("href", "/metrics");
    expect(getNavigationLink("Settings")).toHaveAttribute("href", "/settings");
  });

  it("exposes the navigation and route-content pane roots", () => {
    const { container } = renderLayout();

    const mains = container.querySelectorAll("main");
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAccessibleName("Main content");

    expect(container.querySelector('[data-focus-pane="nav-sidebar"]')).toHaveAccessibleName(
      "Navigation sidebar"
    );
  });

  it("moves link focus with ArrowUp, ArrowDown, Home, and End", async () => {
    const user = userEvent.setup();
    renderLayout();
    const projects = getNavigationLink("Projects");
    const notes = getNavigationLink("Notes");
    const settings = getNavigationLink("Settings");

    projects.focus();
    await user.keyboard("{ArrowDown}");
    expect(notes).toHaveFocus();

    await user.keyboard("{End}");
    expect(settings).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(getNavigationLink("Metrics")).toHaveFocus();

    await user.keyboard("{Home}");
    expect(projects).toHaveFocus();
  });

  it("uses localized typeahead and Enter for client-side routing", async () => {
    const user = userEvent.setup();
    i18nState.language = "es";
    renderLayout();
    const nav = screen.getByRole("navigation", { name: translations.es["nav.primary"] });
    const projects = within(nav).getByText("Proyectos").closest("a") as HTMLAnchorElement;
    const settings = within(nav).getByText("Configuración").closest("a") as HTMLAnchorElement;

    projects.focus();
    await user.keyboard("conf");
    expect(settings).toHaveFocus();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("current-route")).toHaveTextContent("/settings"));
  });

  it("navigates to a destination on a single click", async () => {
    const user = userEvent.setup();
    renderLayout("/");
    expect(screen.getByTestId("current-route")).toHaveTextContent("/");

    await user.click(getNavigationLink("Settings"));
    await waitFor(() => expect(screen.getByTestId("current-route")).toHaveTextContent("/settings"));
  });

  it("keeps selection off so a single click navigates instead of selecting", () => {
    renderLayout("/settings");
    for (const name of ["Projects", "Notes", "Canvas", "Metrics", "Settings"]) {
      expect(getNavigationLink(name)).not.toHaveAttribute("aria-selected");
    }
  });

  it("exposes the current route as the current destination", () => {
    renderLayout("/settings");
    const settings = getNavigationLink("Settings");
    const projects = getNavigationLink("Projects");

    expect(within(settings).getByText("Settings")).toHaveAttribute("aria-current", "page");
    expect(within(projects).getByText("Projects")).not.toHaveAttribute("aria-current");
  });

  it("moves focus into the mobile drawer and traps Tab away from the background", async () => {
    const user = userEvent.setup();
    renderLayout();
    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    const backgroundAction = screen.getByRole("button", { name: "Background action" });

    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Primary navigation" });
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

    for (let index = 0; index < 10; index += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      expect(backgroundAction).not.toHaveFocus();
    }
  });

  it("closes the mobile drawer with Escape and restores focus to its trigger", async () => {
    const user = userEvent.setup();
    renderLayout();
    const trigger = screen.getByRole("button", { name: "Open navigation menu" });

    await user.click(trigger);
    expect(await screen.findByRole("dialog", { name: "Primary navigation" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("closes the mobile drawer from the backdrop and restores focus", async () => {
    const user = userEvent.setup();
    renderLayout();
    const trigger = screen.getByRole("button", { name: "Open navigation menu" });

    await user.click(trigger);
    await user.click(await screen.findByTestId("mobile-menu-backdrop"));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("closes the mobile drawer through the back-dismiss registry and restores focus", async () => {
    const user = userEvent.setup();
    renderLayout();
    const trigger = screen.getByRole("button", { name: "Open navigation menu" });

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog", { name: "Primary navigation" })).toBeInTheDocument();

    act(() => {
      expect(runTopBackDismiss()).toBe(true);
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(runTopBackDismiss()).toBe(false);
  });

  it("localizes the mobile drawer open and close accessible names", async () => {
    const user = userEvent.setup();
    i18nState.language = "es";
    renderLayout();

    await user.click(screen.getByRole("button", { name: "Abrir menú de navegación" }));
    expect(screen.getByRole("button", { name: "Cerrar menú de navegación" })).toBeInTheDocument();
  });

  it("preserves version, update, and theme controls", async () => {
    const user = userEvent.setup();
    renderLayout();

    expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Update v99.0.0" })).toHaveAttribute(
      "href",
      DOWNLOAD_PAGE
    );

    await user.click(screen.getByRole("button", { name: "Dark" }));
    expect(useThemeStore.getState().theme).toBe("dark");
  });

  it("renders ThemeToggle buttons with localized English names", () => {
    i18nState.language = "en";
    renderLayout();
    expect(screen.getByRole("button", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "System" })).toBeInTheDocument();
  });

  it("renders ThemeToggle buttons with localized Spanish names", () => {
    i18nState.language = "es";
    renderLayout();
    expect(screen.getByRole("button", { name: "Claro" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Oscuro" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sistema" })).toBeInTheDocument();
  });

  it("resizes the sidebar via the drag handle", () => {
    const { container } = renderLayout();
    const handle = container.querySelector(".cursor-col-resize");
    expect(handle).not.toBeNull();

    fireEvent.mouseDown(handle as Element, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 150 });
    expect(useSettingsStore.getState().mainSidebarWidth).toBe(330);

    fireEvent.mouseMove(document, { clientX: 1000 });
    expect(useSettingsStore.getState().mainSidebarWidth).toBe(480);

    fireEvent.mouseUp(document);
    fireEvent.mouseMove(document, { clientX: 100 });
    expect(useSettingsStore.getState().mainSidebarWidth).toBe(480);
  });
});
