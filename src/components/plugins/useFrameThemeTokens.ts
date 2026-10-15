/**
 * The live Frame theme-token bridge (#454 unit U4, ADR 0021 D3): recomputes the
 * public `--maibuk-*` token map whenever a value changes, so `PluginFrame` can
 * post the current map to a loaded Frame.
 *
 * Every one of these variables is written on the root element — the theme class
 * (`document.documentElement.classList`) and the accent and app-font inline
 * properties. A `MutationObserver` on the root's attributes therefore catches
 * every writer through one path, and it fires *after* the DOM is updated, so the
 * read always sees the committed value. `requestAnimationFrame` would race
 * React's passive effects, which are what write these variables, and could read
 * the previous frame; the observer cannot.
 *
 * The theme store is read so a `system` theme re-checks on the OS preference,
 * and the Settings store's accent/font fields are subscribed so a change that
 * lands without a fresh attribute mutation is not missed. Both only schedule a
 * recompute; the observer is what makes the timing correct.
 */

import { useCallback, useEffect, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { useThemeStore } from "@/features/theme";
import { readFrameThemeTokens } from "@/features/plugins/frame";

/** Whether two token maps carry exactly the same names and values. */
function tokensEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const names = Object.keys(a);
  if (names.length !== Object.keys(b).length) return false;
  for (const name of names) {
    if (a[name] !== b[name]) return false;
  }
  return true;
}

/**
 * The current Frame theme tokens, stable across renders until a value actually
 * changes (a changed map is a new object; an unchanged one is the same object,
 * so a post bound to it never fires spuriously).
 */
export function useFrameThemeTokens(): Record<string, string> {
  const theme = useThemeStore((state) => state.theme);
  const primaryColor = useSettingsStore((state) => state.primaryColor);
  const appFontSize = useSettingsStore((state) => state.appFontSize);
  const appFont = useSettingsStore((state) => state.appFont);

  const [tokens, setTokens] = useState<Record<string, string>>(() =>
    typeof document === "undefined" ? {} : readFrameThemeTokens()
  );

  const recompute = useCallback(() => {
    setTokens((previous) => {
      const next = readFrameThemeTokens();
      return tokensEqual(previous, next) ? previous : next;
    });
  }, []);

  // The committed source of every token: the root's class, inline style, and
  // data attributes. This fires after the write, so the read is never stale.
  useEffect(() => {
    const observer = new MutationObserver(recompute);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => observer.disconnect();
  }, [recompute]);

  // A store change is what schedules the DOM write; re-read once it has landed.
  useEffect(() => {
    recompute();
  }, [recompute, theme, primaryColor, appFontSize, appFont]);

  // A `system` theme follows the OS preference.
  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => recompute();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [recompute, theme]);

  return tokens;
}
