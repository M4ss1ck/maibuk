import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle";
import { APP_VERSION, DOWNLOAD_PAGE } from "../constants";
import { useVersionCheck } from "../features/version";
import { useTranslation } from "react-i18next";
import { ProjectsIcon, SettingsIcon, CloseIcon, MaibukLogo } from "./icons";
import { BarChart3, Menu, NotebookPen } from "lucide-react";
import { KeyboardShortcut } from "./ui";
import { useSettingsStore } from "../features/settings/store";

export function Layout() {
  const { t } = useTranslation();
  const { latestVersion, isOutdated } = useVersionCheck(APP_VERSION);
  const updateAvailable = isOutdated && latestVersion;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mainSidebarWidth = useSettingsStore((s) => s.mainSidebarWidth);
  const setMainSidebarWidth = useSettingsStore((s) => s.setMainSidebarWidth);
  const isResizing = useRef(false);

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  // Sidebar drag-resize handler
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startWidth = mainSidebarWidth;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizing.current) return;
        const newWidth = Math.max(
          200,
          Math.min(480, startWidth + moveEvent.clientX - startX),
        );
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
    [mainSidebarWidth, setMainSidebarWidth],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMobileMenu();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-background border-b border-border flex items-center px-4 z-40">
        <button
          type="button"
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-2 hover:bg-muted rounded-lg transition-colors"
          aria-label="Open menu"
        >
          <Menu className="w-6 h-6" />
        </button>
        <div className="flex-1 flex items-center justify-center gap-2">
          <MaibukLogo className="w-8 text-primary" />
          <h1 className="text-lg font-semibold">{t("app.title")}</h1>
        </div>
        <div className="w-10" /> {/* Spacer for symmetry */}
      </div>

      {/* Mobile menu overlay */}
      {isMobileMenuOpen && (
        <button
          type="button"
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={closeMobileMenu}
          aria-label="Close menu"
        />
      )}

      {/* Sidebar - hidden on mobile, shown as drawer when menu is open */}
      <aside
        style={{ width: `${mainSidebarWidth}px` }}
        className={`
          fixed md:relative z-50 md:z-auto shrink-0
          h-full
          border-r border-border flex flex-col bg-background
          transform transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
      >
        <div className="px-4 border-b border-border flex flex-row items-end gap-2 justify-start">
          <MaibukLogo className="w-14 text-primary" />
          <h1 className="text-3xl mb-1 font-semibold">{t("app.title")}</h1>
          {/* Close button for mobile */}
          <button
            type="button"
            onClick={closeMobileMenu}
            className="md:hidden ml-auto p-2 hover:bg-muted rounded-lg transition-colors mb-1"
            aria-label="Close menu"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-2 gap-2">
          <NavLink
            to="/"
            onClick={closeMobileMenu}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${isActive
                ? "bg-primary text-white"
                : "hover:bg-muted text-foreground"
              }`
            }
          >
            <ProjectsIcon className="w-5 h-5 shrink-0" />
            <span className="flex-1 truncate">{t("common.projects")}</span>
            <KeyboardShortcut
              keys={["g", "p"]}
              className="ml-auto hidden lg:inline-flex"
            />
          </NavLink>

          <NavLink
            to="/notes"
            onClick={closeMobileMenu}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 my-2 rounded-lg transition-colors ${isActive
                ? "bg-primary text-white"
                : "hover:bg-muted text-foreground"
              }`
            }
          >
            <NotebookPen className="w-5 h-5 shrink-0" />
            <span className="flex-1 truncate">{t("common.notes")}</span>
            <KeyboardShortcut
              keys={["g", "n"]}
              className="ml-auto hidden lg:inline-flex"
            />
          </NavLink>

          <NavLink
            to="/metrics"
            onClick={closeMobileMenu}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 my-2 rounded-lg transition-colors ${isActive
                ? "bg-primary text-white"
                : "hover:bg-muted text-foreground"
              }`
            }
          >
            <BarChart3 className="w-5 h-5 shrink-0" />
            <span className="flex-1 truncate">{t("common.metrics")}</span>
            <KeyboardShortcut
              keys={["g", "m"]}
              className="ml-auto hidden lg:inline-flex"
            />
          </NavLink>

          <NavLink
            to="/settings"
            onClick={closeMobileMenu}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 my-2 rounded-lg transition-colors ${isActive
                ? "bg-primary text-white"
                : "hover:bg-muted text-foreground"
              }`
            }
          >
            <SettingsIcon className="w-5 h-5 shrink-0" />
            <span className="flex-1 truncate">{t("common.settings")}</span>
            <KeyboardShortcut
              keys={["g", "s"]}
              className="ml-auto hidden lg:inline-flex"
            />
          </NavLink>
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

        {/* Drag handle to resize the sidebar (desktop only) */}
        <div
          onMouseDown={handleResizeStart}
          className="hidden md:block absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
        />
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden pt-14 md:pt-0">
        <Outlet />
      </main>
    </div>
  );
}
