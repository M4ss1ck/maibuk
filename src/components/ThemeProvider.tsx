import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useThemeStore, applyTheme } from "@/features/theme";
import { isEmbedPath } from "@/lib/embed";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((state) => state.theme);
  const { pathname } = useLocation();
  const onEmbed = isEmbedPath(pathname);

  useEffect(() => {
    // The Embed route owns the document theme through its ?theme parameter, so
    // the app-wide theme must not override it.
    if (onEmbed) return;
    applyTheme(theme);

    // Listen for system theme changes when in "system" mode
    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme("system");
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, [theme, onEmbed]);

  return <>{children}</>;
}
