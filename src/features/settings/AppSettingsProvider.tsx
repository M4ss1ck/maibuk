import { useEffect } from "react";
import { useSettingsStore } from "@/features/settings/store";
import i18n from "@/i18n";
import type { FontFamily } from "@/features/settings/types";
import { applyAccentColor } from "@/features/settings/accent-color";
import { setWindowAlwaysOnTop, isLaunchOnStartupEnabled, IS_DESKTOP } from "@/lib/platform";

const FONT_FAMILY_MAP: Record<FontFamily, string> = {
  serif: "var(--font-serif)",
  sans: "var(--font-sans)",
  mono: "var(--font-mono)",
};

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const {
    appFontSize,
    appFont,
    primaryColor,
    language,
    hideKeyboardHints,
    alwaysOnTop,
    editorZoom,
    editorContentWidth,
    editorPagePadding,
  } = useSettingsStore();

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--app-font-size", `${appFontSize}px`);
    root.style.setProperty("--app-font-family", FONT_FAMILY_MAP[appFont]);
  }, [appFontSize, appFont]);

  useEffect(() => {
    document.documentElement.style.setProperty("--editor-zoom", `${editorZoom / 100}`);
  }, [editorZoom]);

  useEffect(() => {
    document.documentElement.style.setProperty("--editor-content-width", `${editorContentWidth}px`);
  }, [editorContentWidth]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--editor-page-padding",
      `${editorPagePadding.top}px ${editorPagePadding.right}px ${editorPagePadding.bottom}px ${editorPagePadding.left}px`
    );
  }, [editorPagePadding]);

  useEffect(() => {
    applyAccentColor(primaryColor);
  }, [primaryColor]);

  useEffect(() => {
    // Ensure i18n language is synchronized with settings language
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.hideKeyboardHints = hideKeyboardHints ? "true" : "false";
  }, [hideKeyboardHints]);

  useEffect(() => {
    if (!IS_DESKTOP) return;
    void setWindowAlwaysOnTop(alwaysOnTop).catch((error) => {
      console.error("Failed to set always-on-top:", error);
    });
  }, [alwaysOnTop]);

  useEffect(() => {
    if (!IS_DESKTOP) return;
    let cancelled = false;
    void isLaunchOnStartupEnabled().then((enabled) => {
      if (!cancelled && enabled !== useSettingsStore.getState().launchOnStartup) {
        useSettingsStore.setState({ launchOnStartup: enabled });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <>{children}</>;
}
