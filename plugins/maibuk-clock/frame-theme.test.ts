import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The app styles every scrollbar globally in src/index.css, but a Frame's
// opaque origin keeps those rules out, so the Frame draws the same bar
// itself from the --maibuk-* tokens the host writes on its <html>
// (docs/agents/design.md, "Scrollbars follow the theme by themselves").
const html = readFileSync(join(__dirname, "assets/ui/clock.html"), "utf8");
const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

/** The declarations of the first rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = style.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

/** The declarations Firefox reads, from the block that keeps them from Chromium. */
function firefoxScrollbarProperties(): string {
  return (
    style.match(/@supports not selector\(::-webkit-scrollbar\)\s*\{\s*\*\s*\{([^}]*)\}/)?.[1] ?? ""
  );
}

/** The translucent muted-foreground the app's own scrollbar thumb is painted with. */
const APP_THUMB =
  /color-mix\(in srgb,\s*var\(--maibuk-color-muted-foreground\)\s*45%,\s*transparent\)/;

describe("Clock Frame themed scrollbars", () => {
  it("styles every scroll container in WebKit and Chromium, corner included", () => {
    for (const part of ["", "-track", "-thumb", "-corner"]) {
      expect(style, `::-webkit-scrollbar${part}`).toMatch(
        new RegExp(`\\n\\s*::-webkit-scrollbar${part}\\s*\\{`)
      );
    }
  });

  it("gives Firefox the standard properties only where ::-webkit-scrollbar is unsupported", () => {
    const gated = firefoxScrollbarProperties();
    expect(gated).toMatch(/scrollbar-width:\s*thin;/);
    expect(gated).toMatch(/scrollbar-color:/);
  });

  it("paints the bar from the theme tokens, not a color of its own", () => {
    const thumb = ruleBody("::-webkit-scrollbar-thumb");
    expect(thumb).toMatch(APP_THUMB);
    expect(thumb).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(firefoxScrollbarProperties()).toMatch(APP_THUMB);
  });
});
