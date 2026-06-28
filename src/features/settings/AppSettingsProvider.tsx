import { useEffect } from "react";
import { useSettingsStore } from "./store";
import i18n from "../../i18n";
import type { FontFamily } from "./types";
import { setWindowAlwaysOnTop, isLaunchOnStartupEnabled } from "../../lib/platform";

const FONT_FAMILY_MAP: Record<FontFamily, string> = {
  serif: "var(--font-serif)",
  sans: "var(--font-sans)",
  mono: "var(--font-mono)",
};

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const safeHex =
    normalized.length === 3
      ? normalized
          .split("")
          .map((ch) => `${ch}${ch}`)
          .join("")
      : normalized;

  const r = Number.parseInt(safeHex.slice(0, 2), 16);
  const g = Number.parseInt(safeHex.slice(2, 4), 16);
  const b = Number.parseInt(safeHex.slice(4, 6), 16);
  return { r, g, b };
}

function rgbToHex(r: number, g: number, b: number) {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`.toUpperCase();
}

function darken(hex: string, amount: number) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

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
    document.documentElement.style.setProperty(
      "--editor-zoom",
      `${editorZoom / 100}`
    );
  }, [editorZoom]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--editor-content-width",
      `${editorContentWidth}px`,
    );
  }, [editorContentWidth]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--editor-page-padding",
      `${editorPagePadding.top}px ${editorPagePadding.right}px ${editorPagePadding.bottom}px ${editorPagePadding.left}px`,
    );
  }, [editorPagePadding]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--color-primary", primaryColor);
    root.style.setProperty("--color-primary-hover", darken(primaryColor, 0.12));
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
    void setWindowAlwaysOnTop(alwaysOnTop).catch((error) => {
      console.error("Failed to set always-on-top:", error);
    });
  }, [alwaysOnTop]);

  useEffect(() => {
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
