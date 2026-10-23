// Types for the startup screen generator, so `tsc` can type-check
// vite.config.ts and the test without enabling `allowJs` project-wide.
export const LOGO_SOURCE: string;
export const CSS_SOURCE: string;
export const BOOT_SCRIPT_SOURCE: string;
export const SCREEN_TOKENS: string[];
export const ENTRANCE_KEYFRAMES: string;

export interface StartupLogoSvg {
  viewBox: string;
  fillRule: string;
  d: string;
}

export interface StartupTokens {
  light: Record<string, string>;
  dark: Record<string, string>;
}

export interface StartupScreenSource {
  logo: StartupLogoSvg;
  tokens: StartupTokens;
  keyframes: string;
  bootScript: string;
}

export interface StartupScreenParts {
  head: string;
  root: string;
}

export interface StartupScreenPlugin {
  name: string;
  transformIndexHtml: {
    order: "pre";
    handler(html: string, ctx?: unknown): string;
  };
}

export function extractLogoSvg(tsxSource: string): StartupLogoSvg;

export function extractTokenDefaults(css: string): StartupTokens;

export function extractKeyframes(css: string, name: string): string;

export function renderStartupScreen(source: StartupScreenSource): StartupScreenParts;

export function applyStartupScreen(html: string, parts: StartupScreenParts): string;

export function startupScreenPlugin(options: { root: string }): StartupScreenPlugin;
