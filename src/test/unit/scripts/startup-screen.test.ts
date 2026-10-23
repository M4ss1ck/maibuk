import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MaibukLogo } from "@/components/icons/MaibukLogo";
import {
  extractKeyframes,
  extractLogoSvg,
  extractRuleDeclaration,
  extractTokenDefaults,
  renderStartupScreen,
  startupEntranceAnimation,
  startupScreenPlugin,
} from "../../../../scripts/startup-screen.mjs";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const CSS = read("src/index.css");
const LOGO = read("src/components/icons/MaibukLogo.tsx");
const BOOT_SCRIPT = read("src/features/theme/boot-theme-script.js");
const INDEX_HTML = read("index.html");
const MESSAGES = JSON.parse(read("src/locales/en.json")) as {
  startup: { loading: string };
};
const RUST_WINDOW_BACKGROUND = read("src-tauri/src/window_background.rs");

function logo() {
  return extractLogoSvg(LOGO);
}

function parts() {
  return renderStartupScreen({
    logo: logo(),
    tokens: extractTokenDefaults(CSS),
    keyframes: extractKeyframes(CSS, "logo-entrance"),
    animation: startupEntranceAnimation(CSS),
    bootScript: BOOT_SCRIPT,
    status: MESSAGES.startup.loading,
  });
}

function generateIndexHtml(html: string): string {
  return startupScreenPlugin({ root }).transformIndexHtml.handler(html);
}

/** A value read block-locally with a throwaway regex, independent of the script. */
function tokenInBlock(css: string, block: string, token: string): string {
  const start = css.indexOf(block);
  const end = css.indexOf("}", start);
  const match = new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(css.slice(start, end));
  return (match?.[1] ?? "").trim();
}

/** One declaration read independently of the script, the way `.loading-entrance` declares it. */
function declarationInRule(css: string, selector: string, property: string): string {
  return tokenInBlock(css, `${selector} {`, property);
}

function attribute(markup: string, name: string): string | undefined {
  return new RegExp(`${name}="([^"]*)"`).exec(markup)?.[1];
}

describe("extractLogoSvg()", () => {
  it("reads the same path and viewBox the component renders", () => {
    const markup = renderToStaticMarkup(createElement(MaibukLogo, {}));
    const extracted = logo();

    expect(extracted.d).toBe(attribute(markup, "d"));
    expect(extracted.viewBox).toBe(attribute(markup, "viewBox"));
    expect(extracted.fillRule).toBe(attribute(markup, "fill-rule"));
    expect(extracted.d.length).toBeGreaterThan(100);
  });

  it("throws a clear error when the path is missing", () => {
    expect(() => extractLogoSvg('<svg viewBox="0 0 1 1" fillRule="evenodd"></svg>')).toThrow(
      /path/
    );
  });

  it("throws a clear error when the viewBox is missing", () => {
    expect(() => extractLogoSvg('<svg fillRule="evenodd"><path d="M0 0"/></svg>')).toThrow(
      /viewBox/
    );
  });
});

describe("extractTokenDefaults()", () => {
  it("reads both tokens from the light and the dark blocks", () => {
    const tokens = extractTokenDefaults(CSS);

    expect(tokens.light["--color-background"]).toBe(
      tokenInBlock(CSS, "@theme {", "--color-background")
    );
    expect(tokens.light["--color-primary"]).toBe(tokenInBlock(CSS, "@theme {", "--color-primary"));
    expect(tokens.dark["--color-background"]).toBe(
      tokenInBlock(CSS, ".dark {", "--color-background")
    );
    expect(tokens.dark["--color-primary"]).toBe(tokenInBlock(CSS, ".dark {", "--color-primary"));
  });

  it("throws when a token is missing from a block", () => {
    expect(() =>
      extractTokenDefaults(
        "@theme { --color-background: #ffffff; } .dark { --color-background: #000000; }"
      )
    ).toThrow(/--color-primary/);
  });

  it("throws when the dark block is missing", () => {
    expect(() =>
      extractTokenDefaults("@theme { --color-background: #ffffff; --color-primary: #000000; }")
    ).toThrow(/\.dark/);
  });
});

describe("extractKeyframes()", () => {
  it("returns the logo-entrance body", () => {
    const body = extractKeyframes(CSS, "logo-entrance");

    expect(body).toContain("opacity: 0");
    expect(body).toContain("scale(0.8)");
    expect(body).toContain("opacity: 1");
    expect(body).toContain("scale(1)");
  });

  it("throws on a missing keyframes block", () => {
    expect(() =>
      extractKeyframes("@keyframes other { 0% { opacity: 0; } }", "logo-entrance")
    ).toThrow(/logo-entrance/);
  });
});

describe("extractRuleDeclaration()", () => {
  it("reads the animation the .loading-entrance rule declares", () => {
    expect(extractRuleDeclaration(CSS, ".loading-entrance", "animation")).toBe(
      declarationInRule(CSS, ".loading-entrance", "animation")
    );
  });

  it("throws when the rule is missing", () => {
    expect(() =>
      extractRuleDeclaration(".other { animation: fade-in 1s; }", ".loading-entrance", "animation")
    ).toThrow(/\.loading-entrance/);
  });

  it("throws when the declaration is missing", () => {
    expect(() =>
      extractRuleDeclaration(".loading-entrance { opacity: 1; }", ".loading-entrance", "animation")
    ).toThrow(/animation/);
  });
});

describe("startupEntranceAnimation()", () => {
  it("is the stylesheet's animation with only the keyframes renamed", () => {
    const stylesheet = declarationInRule(CSS, ".loading-entrance", "animation");

    expect(startupEntranceAnimation(CSS)).toBe(
      stylesheet.replace(/^logo-entrance/, "startup-logo-entrance")
    );
  });

  it("throws when the rule does not borrow the logo-entrance keyframes", () => {
    expect(() => startupEntranceAnimation(".loading-entrance { animation: fade-in 1s; }")).toThrow(
      /logo-entrance/
    );
  });
});

describe("renderStartupScreen()", () => {
  it("renders the root markup with a decorative logo and a status label", () => {
    const { root: markup } = parts();

    expect(markup).toContain('<div id="startup-screen">');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain(`<path d="${logo().d}"/>`);
    expect(markup).toContain('role="status"');
    expect(markup).toContain(MESSAGES.startup.loading);
    expect(markup).toContain('class="startup-sr-only"');
  });

  it("escapes the status text for HTML", () => {
    const { root: markup } = renderStartupScreen({
      logo: logo(),
      tokens: extractTokenDefaults(CSS),
      keyframes: extractKeyframes(CSS, "logo-entrance"),
      animation: startupEntranceAnimation(CSS),
      bootScript: BOOT_SCRIPT,
      status: "Loading <Maibuk> & friends",
    });

    expect(markup).toContain("Loading &lt;Maibuk&gt; &amp; friends");
    expect(markup).not.toContain("<Maibuk>");
  });

  it("keeps the inline head small", () => {
    expect(Buffer.byteLength(parts().head, "utf8")).toBeLessThan(4096);
  });

  it("inlines the style, the reduced-motion rule, and the fallback colors", () => {
    const { head } = parts();
    const tokens = extractTokenDefaults(CSS);

    expect(head).toContain("<style>");
    expect(head).toContain(`var(--color-background,${tokens.light["--color-background"]})`);
    expect(head).toContain(`var(--color-primary,${tokens.light["--color-primary"]})`);
    expect(head).toContain(`var(--color-background,${tokens.dark["--color-background"]})`);
    expect(head).toContain(`var(--color-primary,${tokens.dark["--color-primary"]})`);
    expect(head).toContain("@media (prefers-reduced-motion: reduce)");
    expect(head).toContain("animation:none");
    expect(head).toContain("html[data-booting] body{transition:none!important}");
    expect(head).toContain("@keyframes startup-logo-entrance");
  });

  it("times the inline logo exactly as the stylesheet's .loading-entrance rule does", () => {
    const stylesheet = declarationInRule(CSS, ".loading-entrance", "animation");
    const expected = stylesheet.replace(/^logo-entrance/, "startup-logo-entrance");
    const { head } = parts();

    expect(head).toContain(`animation:${expected}`);
    expect(head).toContain("@keyframes startup-logo-entrance");
  });

  it("inlines the boot script verbatim as a classic script", () => {
    const { head } = parts();

    expect(head).toContain(`<script>${BOOT_SCRIPT}</script>`);
    expect(head).not.toContain('type="module"');
  });
});

describe("window_background.rs", () => {
  /** One `Color(r, g, b, a)` literal, as the `#rrggbb` the stylesheet uses. */
  function rustColor(name: "LIGHT" | "DARK"): string {
    const match = new RegExp(
      `const ${name}: Color = Color\\((\\d+), (\\d+), (\\d+), \\d+\\)`
    ).exec(RUST_WINDOW_BACKGROUND);
    if (!match) throw new Error(`no ${name} Color literal in window_background.rs`);
    return `#${match
      .slice(1, 4)
      .map((channel) => Number(channel).toString(16).padStart(2, "0"))
      .join("")}`;
  }

  it("defaults to the stylesheet's --color-background, light and dark", () => {
    const tokens = extractTokenDefaults(CSS);

    expect(rustColor("LIGHT")).toBe(tokens.light["--color-background"]);
    expect(rustColor("DARK")).toBe(tokens.dark["--color-background"]);
  });
});

describe("startupScreenPlugin()", () => {
  it("inserts the head before the title and the first stylesheet", () => {
    const html = generateIndexHtml(INDEX_HTML);

    const styleAt = html.indexOf("<style>");
    expect(styleAt).toBeGreaterThan(html.indexOf('<meta charset="UTF-8" />'));
    expect(styleAt).toBeLessThan(html.indexOf("<title>"));
    expect(styleAt).toBeLessThan(html.indexOf("<head>") + 200);
  });

  it("takes the status label from the English messages", () => {
    const html = generateIndexHtml(INDEX_HTML);

    expect(MESSAGES.startup.loading).toBeTruthy();
    expect(html).toContain(`role="status">${MESSAGES.startup.loading}</span>`);
  });

  it("fills the root and marks the html element as booting", () => {
    const html = generateIndexHtml(INDEX_HTML);

    expect(html).toContain('<div id="root"><div id="startup-screen">');
    expect(html).toContain('<html data-booting lang="en">');
  });

  it("throws when index.html has no empty root", () => {
    const html =
      '<!doctype html><html><head><meta charset="UTF-8" /><title>Maibuk</title></head><body><div id="root">x</div></body></html>';

    expect(() => generateIndexHtml(html)).toThrow(/root/);
  });

  it("paints the startup screen and boots the theme in jsdom", () => {
    const dom = new JSDOM(generateIndexHtml(INDEX_HTML), {
      runScripts: "dangerously",
      url: "http://localhost/",
      beforeParse(window) {
        window.localStorage.setItem(
          "maibuk-boot-theme",
          JSON.stringify({ v: 1, mode: "dark", vars: { "--color-primary": "#ff0000" } })
        );
      },
    });

    try {
      const { document } = dom.window;
      expect(document.querySelector("#root #startup-screen")).not.toBeNull();
      expect(document.querySelector("#startup-screen svg")).not.toBeNull();
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe("#ff0000");
    } finally {
      dom.window.close();
    }
  });
});
