import { useState } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle";
import { APP_VERSION } from "../constants";
import { useTranslation } from "react-i18next";
import { ProjectsIcon, SettingsIcon, CloseIcon } from "./icons";
import { Menu } from "lucide-react";
import logo from "../../src-tauri/icons/icon.png";

export function Layout() {
  const { t } = useTranslation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-background border-b border-border flex items-center px-4 z-40">
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-2 hover:bg-muted rounded-lg transition-colors"
          aria-label="Open menu"
        >
          <Menu className="w-6 h-6" />
        </button>
        <div className="flex-1 flex items-center justify-center gap-2">
          <img src={logo} alt="App Logo" className="w-8" />
          <h1 className="text-lg font-semibold">{t("app.title")}</h1>
        </div>
        <div className="w-10" /> {/* Spacer for symmetry */}
      </div>

      {/* Mobile menu overlay */}
      {isMobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={closeMobileMenu}
        />
      )}

      {/* Sidebar - hidden on mobile, shown as drawer when menu is open */}
      <aside
        className={`
          fixed md:relative z-50 md:z-auto
          w-sidebar h-full
          border-r border-border flex flex-col bg-background
          transform transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
      >
        <div className="px-4 border-b border-border flex flex-row items-end gap-2 justify-start">
          <img src={logo} alt="App Logo" className="w-14" />
          <h1 className="text-3xl mb-1 font-semibold">{t("app.title")}</h1>
          {/* Close button for mobile */}
          <button
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
            <ProjectsIcon className="w-5 h-5" />
            {t("common.projects")}
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
            <SettingsIcon className="w-5 h-5" />
            {t("common.settings")}
          </NavLink>
        </nav>

        <div className="p-4 border-t border-border space-y-3">
          <ThemeToggle />
          <p className="text-sm text-muted-foreground">{APP_VERSION}</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden pt-14 md:pt-0">
        <Outlet />
      </main>
    </div>
  );
}
