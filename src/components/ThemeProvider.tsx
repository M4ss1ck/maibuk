import { useEffect, useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import { useThemeStore, applyTheme, writeBootTheme, syncWindowBackground } from "@/features/theme";
import { isEmbedPath } from "@/lib/embed";
import { applyMotion, REDUCED_MOTION_QUERY } from "@/lib/motion";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((state) => state.theme);
  const eink = useThemeStore((state) => state.eink);
  const { pathname } = useLocation();
  const onEmbed = isEmbedPath(pathname);

  useLayoutEffect(() => {
    // The two sources are the OS preference and E-ink Mode (#901).
    const mediaQuery = window.matchMedia?.(REDUCED_MOTION_QUERY);
    const einkMotion = eink && !onEmbed;
    const handler = () => applyMotion((mediaQuery?.matches ?? false) || einkMotion);
    handler();
    if (!mediaQuery) return;
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [eink, onEmbed]);

  useEffect(() => {
    document.documentElement.classList.toggle("eink", eink && !onEmbed);
  }, [eink, onEmbed]);

  useEffect(() => {
    // The Embed route owns the document theme through its ?theme parameter, so
    // the app-wide theme must not override it.
    if (onEmbed) return;
    applyTheme(theme);
    syncWindowBackground();
    writeBootTheme({ mode: theme, eink });

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
  }, [theme, eink, onEmbed]);

  return <>{children}</>;
}
