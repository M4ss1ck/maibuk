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
    "nav.resizeSidebar": "Resize sidebar",
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
    "nav.resizeSidebar": "Redimensionar barra lateral",
    "settings.light": "Claro",
    "settings.dark": "Oscuro",
    "settings.system": "Sistema",
  },
} as const;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { release?: string; width?: number }) => {
      if (key === "nav.sidebarWidthValue")
        return i18nState.language === "es"
          ? `${options?.width} píxeles`
          : `${options?.width} pixels`;
      if (key === "releases.badge") return `Maibuk ${options?.release}, What's new`;
      if (key === "releases.badgeWithUpdate")
        return `Maibuk ${options?.release}, What's new, an update is available`;
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


import { Layout } from "@/components/Layout";
import { APP_VERSION } from "@/constants";
import { useReleaseStore } from "@/features/releases/store";
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

  it("pins the app shell to the viewport so document scrolling cannot displace it", () => {
    const { container } = renderLayout();

    expect(container.firstElementChild).toHaveClass("fixed", "inset-0", "overflow-hidden");
    expect(container.firstElementChild).not.toHaveClass("h-dvh");
  });

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

  it("caps the mobile drawer to the viewport while keeping the desktop width", async () => {
    useSettingsStore.setState({ mainSidebarWidth: 480 });
    const user = userEvent.setup();
    const { container } = renderLayout();

    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const dialog = await screen.findByRole("dialog", { name: "Primary navigation" });
    const mobileAside = dialog.querySelector("aside");
    expect(mobileAside).not.toBeNull();
    expect(mobileAside).toHaveStyle({ width: "480px", maxWidth: "100%" });

    const desktopAside = container.querySelector('[data-focus-pane="nav-sidebar"]');
    expect(desktopAside).toHaveStyle({ width: "480px" });
    expect(desktopAside).not.toHaveStyle({ maxWidth: "100%" });
  });

  it("localizes the mobile drawer open and close accessible names", async () => {
    const user = userEvent.setup();
    i18nState.language = "es";
    renderLayout();

    await user.click(screen.getByRole("button", { name: "Abrir menú de navegación" }));
    expect(screen.getByRole("button", { name: "Cerrar menú de navegación" })).toBeInTheDocument();
  });

  it("opens the Release Notes from the Release badge and keeps the theme controls", async () => {
    const user = userEvent.setup();
    useReleaseStore.setState({ newerReleases: [], isNotesOpen: false });
    renderLayout();

    const badge = screen.getByRole("button", { name: `Maibuk ${APP_VERSION}, What's new` });
    expect(badge).toHaveTextContent(APP_VERSION);
    badge.focus();
    await user.keyboard("{Enter}");
    expect(useReleaseStore.getState().isNotesOpen).toBe(true);

    act(() => {
      useReleaseStore.setState({
        isNotesOpen: false,
        newerReleases: [{ number: "99.0.0", date: null, sections: [] }],
      });
    });
    expect(
      screen.getByRole("button", {
        name: `Maibuk ${APP_VERSION}, What's new, an update is available`,
      })
    ).toHaveTextContent("releases.new");

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

    const sidebar = screen.getByRole("complementary", { name: translations.en["panes.navSidebar"] });
    const before = useSettingsStore.getState().mainSidebarWidth;

    fireEvent.pointerDown(handle as Element, { clientX: 100 });
    fireEvent.pointerMove(document, { clientX: 150 });
    // The drag moves the sidebar itself; the setting is written once, on release.
    expect(sidebar).toHaveStyle({ width: "330px" });
    expect(useSettingsStore.getState().mainSidebarWidth).toBe(before);

    fireEvent.pointerMove(document, { clientX: 1000 });
    expect(sidebar).toHaveStyle({ width: "480px" });

    fireEvent.pointerUp(document);
    expect(useSettingsStore.getState().mainSidebarWidth).toBe(480);
    fireEvent.pointerMove(document, { clientX: 100 });
    expect(useSettingsStore.getState().mainSidebarWidth).toBe(480);
    expect(sidebar).toHaveStyle({ width: "480px" });
  });

  function getResizeHandle() {
    return screen.getByRole("separator", { name: translations.en["nav.resizeSidebar"] });
  }

  async function tabToResizeHandle(user: ReturnType<typeof userEvent.setup>) {
    const handle = getResizeHandle();
    for (let i = 0; i < 20 && document.activeElement !== handle; i++) {
      await user.tab();
    }
    expect(handle).toHaveFocus();
    return handle;
  }

  it("reaches the resize handle with Tab and leaves it with Tab and Shift+Tab", async () => {
    const user = userEvent.setup();
    renderLayout();

    const handle = await tabToResizeHandle(user);
    await user.tab({ shift: true });
    expect(handle).not.toHaveFocus();
    await user.tab();
    expect(handle).toHaveFocus();
    await user.tab();
    expect(handle).not.toHaveFocus();
  });

  it("leaves the resize handle with Escape for the sidebar control used before it, keeping the width", async () => {
    const user = userEvent.setup();
    renderLayout();
    const sidebar = screen.getByRole("complementary", { name: "Navigation sidebar" });

    const handle = await tabToResizeHandle(user);
    await user.tab({ shift: true });
    const before = document.activeElement;
    expect(sidebar).toContainElement(before as HTMLElement);
    await user.tab();
    expect(handle).toHaveFocus();
    // The Tooltip wrapper still opens on focus.
    expect(await screen.findByRole("tooltip")).toHaveTextContent(translations.en["nav.resizeSidebar"]);

    await user.keyboard("{ArrowRight}{Escape}");
    expect(before).toHaveFocus();
    expect(useSettingsStore.getState().mainSidebarWidth).toBe(296);
  });

  it("widens with ArrowRight and narrows with ArrowLeft in 16px steps, keeping focus", async () => {
    const user = userEvent.setup();
    renderLayout();
    const sidebar = screen.getByRole("complementary", { name: "Navigation sidebar" });

    const handle = await tabToResizeHandle(user);
    expect(handle).toHaveAttribute("aria-valuetext", "280 pixels");

    await user.keyboard("{ArrowRight}");
    expect(useSettingsStore.getState().mainSidebarWidth).toBe(296);
    expect(sidebar).toHaveStyle({ width: "296px" });
    expect(handle).toHaveAttribute("aria-valuetext", "296 pixels");
    expect(handle).toHaveFocus();

    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(useSettingsStore.getState().mainSidebarWidth).toBe(264);
    expect(sidebar).toHaveStyle({ width: "264px" });
    expect(handle).toHaveFocus();
  });

  it("clamps keyboard resizing to the 200 and 480 pixel limits", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ mainSidebarWidth: 472 });
    renderLayout();

    const handle = await tabToResizeHandle(user);
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(useSettingsStore.getState().mainSidebarWidth).toBe(480);
    expect(handle).toHaveAttribute("aria-valuenow", "480");

    act(() => useSettingsStore.setState({ mainSidebarWidth: 208 }));
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(useSettingsStore.getState().mainSidebarWidth).toBe(200);
    expect(handle).toHaveAttribute("aria-valuenow", "200");
    expect(handle).toHaveFocus();
  });

  it("leaves the width unchanged on vertical arrows", async () => {
    const user = userEvent.setup();
    renderLayout();

    const handle = await tabToResizeHandle(user);
    await user.keyboard("{ArrowUp}{ArrowDown}");
    expect(useSettingsStore.getState().mainSidebarWidth).toBe(280);
    expect(handle).toHaveFocus();
  });

  it("names the resize handle in Spanish", async () => {
    i18nState.language = "es";
    renderLayout();

    const handle = screen.getByRole("separator", {
      name: translations.es["nav.resizeSidebar"],
    });
    expect(handle).toHaveAttribute("aria-valuetext", "280 píxeles");
  });

  it("keeps the Tutorial anchor on the resize handle", () => {
    renderLayout();
    expect(getResizeHandle()).toHaveAttribute("data-tutorial", "books.remember");
  });
});
