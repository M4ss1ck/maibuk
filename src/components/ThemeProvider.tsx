import { useEffect, useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import { useThemeStore, applyTheme, writeBootTheme, syncWindowBackground } from "@/features/theme";
import { isEmbedPath } from "@/lib/embed";
import { applyMotion, REDUCED_MOTION_QUERY } from "@/lib/motion";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((state) => state.theme);
  const { pathname } = useLocation();
  const onEmbed = isEmbedPath(pathname);

  useLayoutEffect(() => {
    // OS preference OR another source; E-ink Mode (#898) is the only other source to come.
    const mediaQuery = window.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!mediaQuery) return;
    const handler = () => applyMotion(mediaQuery.matches ?? false);
    handler();
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    // The Embed route owns the document theme through its ?theme parameter, so
    // the app-wide theme must not override it.
    if (onEmbed) return;
    applyTheme(theme);
    syncWindowBackground();
    writeBootTheme({ mode: theme });

    // Listen for system theme changes when in "system" mode
    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => {
        applyTheme("system");
        syncWindowBackground();
      };
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, [theme, onEmbed]);

  return <>{children}</>;
}
