/**
 * Maibuk's appearance for Plugins (#942): the resolved color scheme, whether
 * E-ink Mode is applied, and a subscription that delivers every change. No
 * permission is required, and the subscription replays the current value, so a
 * Plugin that starts after a change still learns it and no change is lost
 * between startup and subscription.
 *
 * Every value is read where the app already publishes it, never derived again.
 * The scheme is the one `readFrameThemeTokens` publishes for Frames
 * (`--maibuk-color-scheme`, resolved from the root's `.dark` class, which
 * ThemeProvider writes through the shared `matchMedia` path), and E-ink Mode is
 * the `eink` class ThemeProvider applies to the document (off on the Embed
 * route, which owns its own look). So a Frame and a Plugin agree by
 * construction, and E-ink Mode is reported as applied rather than conflated
 * with the OS reduced-motion preference.
 */

import {
  FRAME_THEME_COLOR_SCHEME,
  readFrameThemeTokens,
} from "@/features/plugins/frame/theme-tokens";
import { useThemeStore } from "@/features/theme";

/** The appearance a Plugin reads: exactly the two values `appearance.changed` carries. */
export interface PluginAppearance {
  /** The resolved scheme the app draws with, never `system`. */
  colorScheme: "light" | "dark";
  /** Whether E-ink Mode is applied to the document right now. */
  eink: boolean;
}

/** Maibuk's appearance right now, read from the classes ThemeProvider applies. */
export function currentPluginAppearance(
  root: Element = document.documentElement
): PluginAppearance {
  const colorScheme =
    readFrameThemeTokens(root)[FRAME_THEME_COLOR_SCHEME] === "dark" ? "dark" : "light";
  return { colorScheme, eink: root.classList.contains("eink") };
}

/** Calls `listener` on every appearance change; returns the unsubscribe. */
export function onPluginAppearanceChange(
  listener: (appearance: PluginAppearance) => void
): () => void {
  let last = currentPluginAppearance();
  const emitIfChanged = () => {
    const next = currentPluginAppearance();
    // Two triggers can see the same committed value (the theme store writes
    // first, the class lands after it): only a real change is an event.
    if (next.colorScheme === last.colorScheme && next.eink === last.eink) return;
    last = next;
    try {
      listener(next);
    } catch (error) {
      // One bad listener must never break the appearance event for the rest.
      console.error("[plugins] appearance listener failed:", error);
    }
  };
  // Both values are classes on the root, and the provider writes them after
  // React applies the setting. Observing `class` therefore reads the committed
  // value, never a stale one; a `system` scheme reaches the class through the
  // provider's own `matchMedia` listener, so an OS change arrives here too.
  const observer = new MutationObserver(emitIfChanged);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  // A store write and the OS preference catch a host that changes the setting
  // without an attribute mutation (no ThemeProvider mounted); the observer
  // above is what makes the read correct once the DOM has the value.
  const offStore = useThemeStore.subscribe(emitIfChanged);
  const media = window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
  media?.addEventListener("change", emitIfChanged);
  return () => {
    observer.disconnect();
    offStore();
    media?.removeEventListener("change", emitIfChanged);
  };
}
