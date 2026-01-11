import { Outlet, NavLink } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle";
import { APP_VERSION } from "../constants";
import { useTranslation } from "react-i18next";
import { ProjectsIcon, SettingsIcon } from "./icons";
import logo from "../../src-tauri/icons/icon.png";

export function Layout() {
  const { t } = useTranslation();

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-sidebar border-r border-border flex flex-col">
        <div className="px-4 border-b border-border flex flex-row items-end gap-2 justify-start">
          <img src={logo} alt="App Logo" className="w-14" />
          <h1 className="text-3xl mb-1 font-semibold">{t("app.title")}</h1>
        </div>

        <nav className="flex-1 p-2 gap-2">
          <NavLink
            to="/"
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
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
