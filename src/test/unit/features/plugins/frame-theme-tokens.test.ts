// The Frame theme-token contract (#454 unit U4, ADR 0021 D3). `readFrameThemeTokens`
// resolves each internal CSS variable to its stable public name; the table is
// frozen and must keep its exact public names, and every source it names must
// still exist in `src/index.css`. Renaming an internal variable is allowed, but
// only through this table — a public name a Plugin relies on cannot drift.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  FRAME_THEME_COLOR_SCHEME,
  FRAME_THEME_TOKENS,
  readFrameThemeTokens,
} from "@/features/plugins/frame";

function setToken(name: string, value: string): void {
  document.documentElement.style.setProperty(name, value);
}

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.classList.remove("dark");
});

describe("FRAME_THEME_TOKENS", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(FRAME_THEME_TOKENS)).toBe(true);
    for (const token of FRAME_THEME_TOKENS) {
      expect(Object.isFrozen(token)).toBe(true);
    }
    expect(() => {
      (FRAME_THEME_TOKENS as unknown as FrameThemeTokenLike[]).push({
        name: "--maibuk-x",
        source: "--x",
      });
    }).toThrow();
  });

  it("keeps the exact public names (a rename fails here)", () => {
    expect(FRAME_THEME_TOKENS.map((token) => token.name)).toEqual([
      "--maibuk-color-primary",
      "--maibuk-color-primary-hover",
      "--maibuk-color-primary-foreground",
      "--maibuk-color-secondary",
      "--maibuk-color-background",
      "--maibuk-color-foreground",
      "--maibuk-color-muted",
      "--maibuk-color-muted-foreground",
      "--maibuk-color-border",
      "--maibuk-color-card",
      "--maibuk-color-card-foreground",
      "--maibuk-color-destructive",
      "--maibuk-color-destructive-hover",
      "--maibuk-color-success",
      "--maibuk-color-info-bg",
      "--maibuk-color-info-text",
      "--maibuk-color-warning-bg",
      "--maibuk-color-warning-text",
      "--maibuk-color-error-bg",
      "--maibuk-color-error-text",
      "--maibuk-color-success-bg",
      "--maibuk-color-success-text",
      "--maibuk-font-sans",
      "--maibuk-font-serif",
      "--maibuk-font-mono",
      "--maibuk-font-size",
      "--maibuk-spacing-editor-max",
    ]);
    expect(FRAME_THEME_COLOR_SCHEME).toBe("--maibuk-color-scheme");
  });

  it("names a source that still exists in src/index.css", () => {
    const css = readFileSync("src/index.css", "utf8");
    for (const token of FRAME_THEME_TOKENS) {
      expect(css, `${token.name} → ${token.source}`).toContain(token.source);
    }
  });

  it("excludes status, table, update, and preview internals", () => {
    const sources = FRAME_THEME_TOKENS.map((token) => token.source).join(" ");
    for (const internal of ["status-", "table-", "update-", "preview-"]) {
      expect(sources).not.toContain(internal);
    }
  });
});

describe("readFrameThemeTokens", () => {
  it("maps each internal source to its public name", () => {
    setToken("--color-primary", "#123456");
    setToken("--font-serif", '"Literata", serif');
    setToken("--app-font-size", "18px");

    const tokens = readFrameThemeTokens();

    expect(tokens["--maibuk-color-primary"]).toBe("#123456");
    expect(tokens["--maibuk-font-serif"]).toBe('"Literata", serif');
    expect(tokens["--maibuk-font-size"]).toBe("18px");
  });

  it("skips a source with no value", () => {
    setToken("--color-primary", "#123456");

    const tokens = readFrameThemeTokens();

    expect(tokens["--maibuk-color-primary"]).toBe("#123456");
    expect(tokens).not.toHaveProperty("--maibuk-color-background");
    expect(tokens).not.toHaveProperty("--maibuk-font-sans");
  });

  it("always publishes the resolved color scheme", () => {
    expect(readFrameThemeTokens()[FRAME_THEME_COLOR_SCHEME]).toBe("light");

    document.documentElement.classList.add("dark");
    expect(readFrameThemeTokens()[FRAME_THEME_COLOR_SCHEME]).toBe("dark");
  });

  it("resolves against any root element", () => {
    const root = document.createElement("div");
    root.style.setProperty("--color-card", "#abcdef");
    document.body.appendChild(root);

    expect(readFrameThemeTokens(root)["--maibuk-color-card"]).toBe("#abcdef");
    root.remove();
  });
});

interface FrameThemeTokenLike {
  name: string;
  source: string;
}
