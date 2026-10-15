/**
 * The Frame theme-token contract (#454 unit U4, ADR 0021 D3). A Frame is an
 * opaque-origin document, so `:root` custom properties do not cross into it:
 * the host resolves them here and the shim writes them onto the Frame's own
 * `<html>`. `FRAME_THEME_TOKENS` is the frozen, Plugin-facing table — a public
 * `--maibuk-*` name (stable; a Plugin may rely on it) beside the internal CSS
 * variable that backs it today. Renaming an internal variable must never change
 * a public name; only the `source` moves.
 *
 * The set is deliberate: semantic colors, the feedback info/warning/error/
 * success background+text pairs, the three font families, the user-chosen body
 * font size, and one real design measure (the editor column). Status, table,
 * update, and preview variables are app internals and stay out. See
 * docs/agents/design.md, "Frame theme tokens".
 */

/** One public Frame token: the name a Frame reads, and the internal source. */
export interface FrameThemeToken {
  /** The stable public custom property a Frame reads (`--maibuk-…`). */
  readonly name: string;
  /** The internal CSS custom property this app owns today (`--…`). */
  readonly source: string;
}

/**
 * The frozen public-to-internal table. Every `source` is a custom property
 * `src/index.css` uses; `frame-theme-tokens.test.ts` reads that file and fails
 * when one disappears, and pins the public names so a rename cannot slip out.
 */
export const FRAME_THEME_TOKENS: readonly FrameThemeToken[] = Object.freeze(
  [
    // Semantic colors.
    { name: "--maibuk-color-primary", source: "--color-primary" },
    { name: "--maibuk-color-primary-hover", source: "--color-primary-hover" },
    { name: "--maibuk-color-primary-foreground", source: "--color-primary-foreground" },
    { name: "--maibuk-color-secondary", source: "--color-secondary" },
    { name: "--maibuk-color-background", source: "--color-background" },
    { name: "--maibuk-color-foreground", source: "--color-foreground" },
    { name: "--maibuk-color-muted", source: "--color-muted" },
    { name: "--maibuk-color-muted-foreground", source: "--color-muted-foreground" },
    { name: "--maibuk-color-border", source: "--color-border" },
    { name: "--maibuk-color-card", source: "--color-card" },
    { name: "--maibuk-color-card-foreground", source: "--color-card-foreground" },
    { name: "--maibuk-color-destructive", source: "--color-destructive" },
    { name: "--maibuk-color-destructive-hover", source: "--color-destructive-hover" },
    { name: "--maibuk-color-success", source: "--color-success" },
    // Feedback banner pairs (info, warning, error, success).
    { name: "--maibuk-color-info-bg", source: "--color-info-bg" },
    { name: "--maibuk-color-info-text", source: "--color-info-text" },
    { name: "--maibuk-color-warning-bg", source: "--color-warning-bg" },
    { name: "--maibuk-color-warning-text", source: "--color-warning-text" },
    { name: "--maibuk-color-error-bg", source: "--color-feedback-error-bg" },
    { name: "--maibuk-color-error-text", source: "--color-feedback-error-text" },
    { name: "--maibuk-color-success-bg", source: "--color-feedback-success-bg" },
    { name: "--maibuk-color-success-text", source: "--color-feedback-success-text" },
    // Typography: the three families and the user-chosen body font size.
    { name: "--maibuk-font-sans", source: "--font-sans" },
    { name: "--maibuk-font-serif", source: "--font-serif" },
    { name: "--maibuk-font-mono", source: "--font-mono" },
    { name: "--maibuk-font-size", source: "--app-font-size" },
    // One real design measure — the editor column (not a layout internal).
    { name: "--maibuk-spacing-editor-max", source: "--spacing-editor-max" },
  ].map((token) => Object.freeze(token))
);

/**
 * The active color scheme. It is not a CSS custom property: a Frame cannot
 * inherit `prefers-color-scheme` reliably across engines, so the host derives
 * the resolved scheme from the root's `.dark` class and always publishes it.
 */
export const FRAME_THEME_COLOR_SCHEME = "--maibuk-color-scheme" as const;

/**
 * Resolves every public token against `root`, reading the computed value of
 * each internal source. An empty value is skipped, so a Frame only ever
 * receives properties the host actually defines. `--maibuk-color-scheme` is
 * always present, as the resolved `light` or `dark`.
 */
export function readFrameThemeTokens(
  root: Element = document.documentElement
): Record<string, string> {
  const computed = getComputedStyle(root);
  const tokens: Record<string, string> = {};
  for (const token of FRAME_THEME_TOKENS) {
    const value = computed.getPropertyValue(token.source).trim();
    if (value !== "") tokens[token.name] = value;
  }
  tokens[FRAME_THEME_COLOR_SCHEME] = root.classList.contains("dark") ? "dark" : "light";
  return tokens;
}
