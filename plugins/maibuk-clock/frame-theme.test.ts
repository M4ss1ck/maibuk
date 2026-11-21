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

  it("paints the root scroller's gutter like the page, never the webview's white", () => {
    // A document's own canvas does not paint under its root scrollbar, so a
    // transparent track there shows the webview's base color, which stays
    // white in the dark theme; the app's own bars never sit on a root
    // scroller, so only the Frame needs this.
    for (const part of ["-track", "-corner"]) {
      expect(ruleBody(`html::-webkit-scrollbar${part}`)).toMatch(
        /background:\s*var\(--maibuk-color-background\);/
      );
    }
  });

  it("keeps a solid token color ahead of the mix for engines that cannot resolve it", () => {
    // The thumb: WebKitGTK's scrollbar paint reads color-mix() as nothing and
    // paints no thumb at all, so the token's own solid color stands in first.
    const thumb = ruleBody("::-webkit-scrollbar-thumb");
    const solid = thumb.match(/background-color:\s*var\(--maibuk-color-muted-foreground\);/);
    const mixed = thumb.match(APP_THUMB);
    expect(solid?.index).toBeDefined();
    expect(mixed?.index).toBeDefined();
    expect(solid?.index ?? 0).toBeLessThan(mixed?.index ?? 0);

    // Firefox's bar gets the same insurance.
    const gated = firefoxScrollbarProperties();
    const solidColor = gated.match(
      /scrollbar-color:\s*var\(--maibuk-color-muted-foreground\)\s+var\(--maibuk-color-background\);/
    );
    const mixedColor = gated.match(APP_THUMB);
    expect(solidColor?.index).toBeDefined();
    expect(mixedColor?.index).toBeDefined();
    expect(solidColor?.index ?? 0).toBeLessThan(mixedColor?.index ?? 0);
  });
});
