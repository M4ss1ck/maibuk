import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FocusScope, Overlay, useModalOverlay } from "react-aria";
import { Dialog, RouterProvider } from "react-aria-components";
import { ListBox, ListBoxItem } from "react-aria-components/ListBox";
import { Outlet, useHref, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BarChart3, Feather, Menu, NotebookPen, Workflow } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CloseIcon, MaibukLogo, ProjectsIcon, SettingsIcon } from "@/components/icons";
import { KeyboardShortcut } from "@/components/ui";
import { APP_VERSION, DOWNLOAD_PAGE } from "@/constants";
import { useSettingsStore } from "@/features/settings/store";
import { useVersionCheck } from "@/features/version";
import { formatKeys, SHORTCUTS } from "@/lib/shortcut-registry";

export function Layout() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { latestVersion, isOutdated } = useVersionCheck(APP_VERSION);
  const updateAvailable = isOutdated && latestVersion;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mainSidebarWidth = useSettingsStore((s) => s.mainSidebarWidth);
  const setMainSidebarWidth = useSettingsStore((s) => s.setMainSidebarWidth);
  const isResizing = useRef(false);
  const mobileDialogRef = useRef<HTMLDivElement>(null);
  const mobileMenuRestoreFocusRef = useRef<HTMLElement | null>(null);
  const wasMobileMenuOpenRef = useRef(false);

  const closeMobileMenu = () => setIsMobileMenuOpen(false);
  const mobileMenuState = useMemo(
    () => ({
      isOpen: isMobileMenuOpen,
      open: () => setIsMobileMenuOpen(true),
      close: closeMobileMenu,
      toggle: () => setIsMobileMenuOpen((open) => !open),
      setOpen: setIsMobileMenuOpen,
    }),
    [isMobileMenuOpen],
  );
  const { modalProps: mobileModalProps, underlayProps: mobileUnderlayProps } =
    useModalOverlay(
      { isDismissable: true },
      mobileMenuState,
      mobileDialogRef,
    );

  if (
    isMobileMenuOpen &&
    !wasMobileMenuOpenRef.current &&
    typeof document !== "undefined"
  ) {
    const activeElement = document.activeElement;
    mobileMenuRestoreFocusRef.current =
      activeElement instanceof HTMLElement ? activeElement : null;
  }
  wasMobileMenuOpenRef.current = isMobileMenuOpen;

  const restoreMobileMenuFocus = () => {
    const target = mobileMenuRestoreFocusRef.current;
    mobileMenuRestoreFocusRef.current = null;
    if (target?.isConnected && target !== document.body) target.focus();
  };

  useLayoutEffect(() => {
    if (!isMobileMenuOpen) restoreMobileMenuFocus();
  }, [isMobileMenuOpen]);

  useLayoutEffect(() => restoreMobileMenuFocus, []);

  const navigationItems = [
    {
      id: "/",
      label: t("common.projects"),
      icon: <ProjectsIcon className="w-5 h-5 shrink-0" />,
      shortcut: SHORTCUTS["global.gotoProjects"],
    },
    {
      id: "/notes",
      label: t("common.notes"),
      icon: <NotebookPen className="w-5 h-5 shrink-0" />,
      shortcut: SHORTCUTS["global.gotoNotes"],
    },
    {
      id: "/canvas",
      label: t("common.canvas"),
      icon: <Workflow className="w-5 h-5 shrink-0" />,
      shortcut: SHORTCUTS["global.gotoCanvas"],
    },
    {
      id: "/ephemeral",
      label: t("common.ephemeral"),
      icon: <Feather className="w-5 h-5 shrink-0" />,
      shortcut: SHORTCUTS["global.gotoEphemeral"],
    },
    {
      id: "/metrics",
      label: t("common.metrics"),
      icon: <BarChart3 className="w-5 h-5 shrink-0" />,
      shortcut: SHORTCUTS["global.gotoMetrics"],
    },
    {
      id: "/settings",
      label: t("common.settings"),
      icon: <SettingsIcon className="w-5 h-5 shrink-0" />,
      shortcut: SHORTCUTS["global.gotoSettings"],
    },
  ];

  const handleResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      isResizing.current = true;
      const startX = event.clientX;
      const startWidth = mainSidebarWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizing.current) return;
        const newWidth = Math.max(200, Math.min(480, startWidth + moveEvent.clientX - startX));
        setMainSidebarWidth(newWidth);
      };

      const onMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [mainSidebarWidth, setMainSidebarWidth]
  );

  const sidebarContent = (mobile: boolean) => (
    <>
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

      <nav className="flex-1 p-2" aria-label={t("nav.primary")}>
        <RouterProvider navigate={navigate} useHref={useHref}>
          <ListBox
            aria-label={t("nav.primary")}
            items={navigationItems}
            dependencies={[i18n.resolvedLanguage, location.pathname]}
            selectionMode="none"
            className="flex flex-col gap-2"
          >
            {(item) => (
              <ListBoxItem
                id={item.id}
                href={item.id}
                textValue={item.label}
                onAction={closeMobileMenu}
                className={({ isFocusVisible }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                    location.pathname === item.id
                      ? "bg-primary text-white"
                      : "hover:bg-muted text-foreground"
                  } ${isFocusVisible ? "outline-2 outline-offset-2 outline-primary" : "outline-none"}`
                }
              >
                {item.icon}
                <span
                  className="flex-1 truncate"
                  aria-current={location.pathname === item.id ? "page" : undefined}
                >
                  {item.label}
                </span>
                <KeyboardShortcut
                  shortcut={formatKeys(item.shortcut)}
                  className="ml-auto hidden lg:inline-flex"
                />
              </ListBoxItem>
            )}
          </ListBox>
        </RouterProvider>
      </nav>

      <div className="p-4 border-t border-border space-y-3">
        <ThemeToggle />
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          {APP_VERSION}
          {updateAvailable && (
            <a
              href={DOWNLOAD_PAGE}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-2 py-0.5 bg-update-bg text-update-text rounded-full hover:opacity-80 transition-opacity truncate"
            >
              {t("settings.updateAvailable", { version: latestVersion })}
            </a>
          )}
        </p>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-background text-foreground">
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-background border-b border-border flex items-center px-4 z-40">
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
              <div
                {...mobileModalProps}
                ref={mobileDialogRef}
                className="contents"
              >
                <Dialog
                  aria-label={t("nav.primary")}
                  className="contents outline-none"
                >
                  <aside
                    style={{ width: `${mainSidebarWidth}px` }}
                    className="h-full border-r border-border flex flex-col bg-background transition duration-300 ease-in-out"
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
        <div
          onMouseDown={handleResizeStart}
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
        />
      </aside>

      <main data-focus-pane="main-content" tabIndex={-1} aria-label={t("panes.mainContent")} className="flex-1 overflow-hidden pt-14 md:pt-0">
        <Outlet />
      </main>
    </div>
  );
}
