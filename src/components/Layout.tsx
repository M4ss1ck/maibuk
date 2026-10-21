import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { FocusScope, Overlay } from "react-aria";
import { Dialog, RouterProvider } from "react-aria-components";
import { ListBox, ListBoxItem, ListBoxSection } from "react-aria-components/ListBox";
import { Outlet, useHref, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BarChart3, Feather, Menu, NotebookPen, Workflow } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CommandPaletteButton } from "@/components/command-palette/CommandPaletteButton";
import { ReleaseBadge } from "@/components/releases/ReleaseBadge";
import { CloseIcon, MaibukLogo, ProjectsIcon, SettingsIcon } from "@/components/icons";
import { KeyboardShortcut, ResizeHandle, Tooltip } from "@/components/ui";
import { PluginIcon } from "@/components/plugins/PluginIcon";
import { PluginSidebarSurfaces } from "@/components/plugins/PluginSidebarSurfaces";
import { useDialogOverlay, useRestoreFocus } from "@/hooks";
import { useSettingsStore } from "@/features/settings/store";
import {
  getPluginSidebarEntries,
  onPluginContributionsChange,
} from "@/features/plugins/contributions-registry";
import { MAIN_SIDEBAR_MAX_WIDTH, MAIN_SIDEBAR_MIN_WIDTH } from "@/features/settings/types";
import { registerBackDismiss } from "@/lib/platform/backDismiss";
import { useCommandHint } from "@/lib/command-keys";
import type { CommandId } from "@/lib/shortcut-registry";

// Tutorial steps that point at a sidebar item (the desktop sidebar only; the
// mobile menu is closed while the Tutorial runs, so those steps show centered).
const NAV_TUTORIAL_ANCHORS: Record<string, string | undefined> = {
  "/metrics": "books.metrics",
  "/settings": "books.settings",
};

function NavShortcut({ id, className }: { id: CommandId; className?: string }) {
  const hint = useCommandHint(id);
  if (!hint) return null;
  return <KeyboardShortcut shortcut={hint.formatted} className={className} />;
}

export function Layout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mainSidebarWidth = useSettingsStore((s) => s.mainSidebarWidth);
  const setMainSidebarWidth = useSettingsStore((s) => s.setMainSidebarWidth);
  const mobileDialogRef = useRef<HTMLDivElement>(null);
  const pluginSidebarEntries = useSyncExternalStore(
    onPluginContributionsChange,
    getPluginSidebarEntries,
    getPluginSidebarEntries
  );

  const closeMobileMenu = () => setIsMobileMenuOpen(false);
  const mobileMenuState = useMemo(
    () => ({
      isOpen: isMobileMenuOpen,
      open: () => setIsMobileMenuOpen(true),
      close: closeMobileMenu,
      toggle: () => setIsMobileMenuOpen((open) => !open),
      setOpen: setIsMobileMenuOpen,
    }),
    [isMobileMenuOpen]
  );
  const { overlayProps: mobileModalProps, underlayProps: mobileUnderlayProps } = useDialogOverlay({
    isOpen: mobileMenuState.isOpen,
    onClose: mobileMenuState.close,
    ref: mobileDialogRef,
  });

  // After useDialogOverlay: its hidden-page cleanup must run before the restore.
  useRestoreFocus(isMobileMenuOpen);

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    return registerBackDismiss(() => {
      setIsMobileMenuOpen(false);
      return true;
    });
  }, [isMobileMenuOpen, setIsMobileMenuOpen]);

  type NavItem = {
    id: string;
    label: string;
    icon: ReactNode;
    shortcut: CommandId;
  };
  // Core destinations first; the pinned tail (Metrics, Settings) is appended
  // after the Plugin entries below, so it always renders last.
  const coreNavigationItems: NavItem[] = [
    {
      id: "/",
      label: t("common.projects"),
      icon: <ProjectsIcon className="w-5 h-5 shrink-0" />,
      shortcut: "global.gotoProjects",
    },
    {
      id: "/notes",
      label: t("common.notes"),
      icon: <NotebookPen className="w-5 h-5 shrink-0" />,
      shortcut: "global.gotoNotes",
    },
    {
      id: "/canvas",
      label: t("common.canvas"),
      icon: <Workflow className="w-5 h-5 shrink-0" />,
      shortcut: "global.gotoCanvas",
    },
    {
      id: "/ephemeral",
      label: t("common.ephemeral"),
      icon: <Feather className="w-5 h-5 shrink-0" />,
      shortcut: "global.gotoEphemeral",
    },
  ];
  const pinnedNavigationItems: NavItem[] = [
    {
      id: "/metrics",
      label: t("common.metrics"),
      icon: <BarChart3 className="w-5 h-5 shrink-0" />,
      shortcut: "global.gotoMetrics",
    },
    {
      id: "/settings",
      label: t("common.settings"),
      icon: <SettingsIcon className="w-5 h-5 shrink-0" />,
      shortcut: "global.gotoSettings",
    },
  ];

  // Plugin sidebar entries follow the core destinations, ordered by the
  // contributions registry (Plugin name, then id, then declared order). A
  // sidebar entry is its page's navigation Command, so it shows the same
  // Shortcut hint as any other navigation control. Metrics and Settings come
  // after them, whether or not a Plugin contributes an entry.
  const pluginNavItems: NavItem[] = pluginSidebarEntries.map((entry) => ({
    id: entry.pageRoute,
    label: entry.title,
    icon: <PluginIcon icon={entry.icon} className="w-5 h-5 shrink-0" />,
    shortcut: entry.commandId,
  }));
  // The core destinations and the Plugin entries share one scrolling section.
  const scrollNavItems = [...coreNavigationItems, ...pluginNavItems];

  const sidebarContent = (mobile: boolean) => {
    const renderNavItem = (item: NavItem) => {
      const isCurrent = location.pathname === item.id;
      return (
        <ListBoxItem
          key={item.id}
          id={item.id}
          href={item.id}
          textValue={item.label}
          data-tutorial={mobile ? undefined : NAV_TUTORIAL_ANCHORS[item.id]}
          onAction={closeMobileMenu}
          className={({ isFocusVisible }) =>
            `flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              isCurrent ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
            } ${isFocusVisible ? "outline-2 outline-offset-2 outline-primary" : "outline-none"}`
          }
        >
          {item.icon}
          <span className="flex-1 truncate" aria-current={isCurrent ? "page" : undefined}>
            {item.label}
          </span>
          <NavShortcut id={item.shortcut} className="ml-auto hidden lg:inline-flex" />
        </ListBoxItem>
      );
    };

    return (
      <>
        <PluginSidebarSurfaces entries={mobile ? [] : pluginSidebarEntries} />
        <div className="px-4 border-b border-border flex flex-row items-end gap-2 justify-start">
          <MaibukLogo className="w-14 text-primary" />
          <div className="text-3xl mb-1 font-semibold">{t("app.title")}</div>
          {mobile && (
            <button
              type="button"
              autoFocus
              onClick={closeMobileMenu}
              className="ml-auto p-2 hover:bg-muted rounded-lg transition-colors mb-1"
              aria-label={t("nav.closeMenu")}
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          )}
        </div>

        <nav
          className="flex flex-1 flex-col min-h-0 p-2"
          aria-label={t("nav.primary")}
          data-tutorial={mobile ? undefined : "books.nav"}
        >
          <RouterProvider navigate={navigate} useHref={useHref}>
            {/* One list, two sections: the core destinations and Plugin entries
                scroll, and Metrics and Settings stay pinned at the bottom. It is
                one roving stop, so Tab and the arrows walk the whole column in
                order, through Ephemeral and any Plugin entry to the pinned pair. */}
            <ListBox
              aria-label={t("nav.primary")}
              selectionMode="none"
              className="flex flex-col min-h-0"
            >
              <ListBoxSection
                id="destinations"
                className="flex flex-col gap-2 min-h-0 overflow-y-auto scrollbar-themed"
              >
                {scrollNavItems.map(renderNavItem)}
              </ListBoxSection>
              <ListBoxSection
                id="pinned"
                aria-label={t("nav.pinned")}
                className="flex flex-col gap-2 shrink-0 pt-2"
              >
                {pinnedNavigationItems.map(renderNavItem)}
              </ListBoxSection>
            </ListBox>
          </RouterProvider>
        </nav>

        <div className="p-4 border-t border-border space-y-3">
          <ThemeToggle />
          <div className="flex items-center justify-between gap-2">
            <ReleaseBadge variant="sidebar" />
            <CommandPaletteButton size="sm" />
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="fixed inset-0 flex overflow-hidden bg-background text-foreground">
      <div className="md:hidden fixed top-0 left-0 right-0 h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))] bg-background border-b border-border flex items-center z-40">
        <button
          type="button"
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-2 hover:bg-muted rounded-lg transition-colors"
          aria-label={t("nav.openMenu")}
        >
          <Menu className="w-6 h-6" />
        </button>
        <div className="flex-1 flex items-center justify-center gap-2">
          <MaibukLogo className="w-8 text-primary" />
          <div className="text-lg font-semibold">{t("app.title")}</div>
        </div>
        <div className="w-10" />
      </div>

      {isMobileMenuOpen && (
        <Overlay disableFocusManagement>
          <div
            {...mobileUnderlayProps}
            data-testid="mobile-menu-backdrop"
            className="fixed inset-0 z-50 flex bg-black/50 md:hidden"
          >
            <FocusScope contain autoFocus>
              <div {...mobileModalProps} ref={mobileDialogRef} className="contents">
                <Dialog aria-label={t("nav.primary")} className="contents outline-none">
                  <aside
                    style={{ width: `${mainSidebarWidth}px`, maxWidth: "100%" }}
                    className="h-full border-r border-border flex flex-col bg-background transition duration-300 ease-in-out pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
                  >
                    {sidebarContent(true)}
                  </aside>
                </Dialog>
              </div>
            </FocusScope>
          </div>
        </Overlay>
      )}

      <aside
        data-focus-pane="nav-sidebar"
        tabIndex={-1}
        aria-label={t("panes.navSidebar")}
        style={{ width: `${mainSidebarWidth}px` }}
        className="hidden md:flex relative shrink-0 h-full border-r border-border flex-col bg-background"
      >
        {sidebarContent(false)}
        <Tooltip content={t("nav.resizeSidebar")}>
          <ResizeHandle
            side="right"
            value={mainSidebarWidth}
            min={MAIN_SIDEBAR_MIN_WIDTH}
            max={MAIN_SIDEBAR_MAX_WIDTH}
            onResize={setMainSidebarWidth}
            label={t("nav.resizeSidebar")}
            data-tutorial="books.remember"
          />
        </Tooltip>
      </aside>

      <main
        data-focus-pane="main-content"
        tabIndex={-1}
        aria-label={t("panes.mainContent")}
        className="flex-1 overflow-hidden pt-[calc(3.5rem+env(safe-area-inset-top))] md:pt-0 pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)]"
      >
        <Outlet />
      </main>
    </div>
  );
}
