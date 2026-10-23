#!/usr/bin/env node
// Paints the startup screen on the first frame, before any JavaScript bundle
// loads (issue #624). `transformIndexHtml` copies the logo, the light/dark token
// defaults, and the logo entrance keyframes out of their real sources at build
// and dev time, then inlines them with the boot theme script in index.html. A
// refactor of those sources breaks the build here instead of drifting silently.
//
// Imported by vite.config.ts and by its unit test; there is no CLI.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The source files the screen copies from, relative to the repo root. */
export const LOGO_SOURCE = "src/components/icons/MaibukLogo.tsx";
export const CSS_SOURCE = "src/index.css";
export const BOOT_SCRIPT_SOURCE = "src/features/theme/boot-theme-script.js";

/** The tokens the first frame needs: the page surface and the logo color. */
export const SCREEN_TOKENS = ["--color-background", "--color-primary"];

/** The keyframes the logo entrance borrows from the stylesheet. */
export const ENTRANCE_KEYFRAMES = "logo-entrance";

const ROOT_MARKER = /<div\s+id="root"\s*><\/div>/;

function fail(message) {
  throw new Error(`startup-screen: ${message}`);
}

/** The body between the braces of the first block whose header matches. */
function blockBody(css, header, label) {
  const match = header.exec(css);
  if (!match) fail(`no ${label} block found`);
  const open = css.indexOf("{", match.index);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return fail(`unterminated ${label} block`);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenValue(body, token, label) {
  const match = new RegExp(`${escapeRegExp(token)}\\s*:\\s*([^;]+);`).exec(body);
  if (!match) fail(`${token} is missing from the ${label} block in ${CSS_SOURCE}`);
  return match[1].trim();
}

/** The `<svg>` attributes and the single path the component draws. */
export function extractLogoSvg(tsxSource) {
  const viewBox = /\bviewBox="([^"]+)"/.exec(tsxSource)?.[1];
  if (!viewBox) fail(`no viewBox in ${LOGO_SOURCE}`);
  const fillRule = /\bfillRule="([^"]+)"/.exec(tsxSource)?.[1];
  if (!fillRule) fail(`no fillRule in ${LOGO_SOURCE}`);
  const d = /<path\b[^>]*\sd="([^"]+)"/.exec(tsxSource)?.[1];
  if (!d) fail(`no <path d="..."> in ${LOGO_SOURCE}`);
  return { viewBox, fillRule, d };
}

/** The light (`@theme`) and dark (`.dark`) defaults of `SCREEN_TOKENS`. */
export function extractTokenDefaults(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const light = blockBody(source, /@theme\s*\{/, "@theme");
  const dark = blockBody(source, /\.dark\s*\{/, ".dark");
  return {
    light: Object.fromEntries(
      SCREEN_TOKENS.map((token) => [token, tokenValue(light, token, "@theme")])
    ),
    dark: Object.fromEntries(
      SCREEN_TOKENS.map((token) => [token, tokenValue(dark, token, ".dark")])
    ),
  };
}

/** The body of an `@keyframes` block, so the startup screen can reuse it. */
export function extractKeyframes(css, name) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return blockBody(
    source,
    new RegExp(`@keyframes\\s+${escapeRegExp(name)}\\s*\\{`),
    `@keyframes ${name}`
  ).trim();
}

/**
 * The inline `<head>` (style plus boot script) and the root markup that fills
 * `<div id="root">`. The visible logo is decorative; the status span carries
 * the screen-reader text until React replaces it with the localized one.
 */
export function renderStartupScreen({ logo, tokens, keyframes, bootScript }) {
  const lightBackground = tokens.light["--color-background"];
  const darkBackground = tokens.dark["--color-background"];
  const lightPrimary = tokens.light["--color-primary"];
  const darkPrimary = tokens.dark["--color-primary"];

  const style = [
    `html,body{margin:0;background-color:var(--color-background,${lightBackground})}`,
    `.dark,.dark body{background-color:var(--color-background,${darkBackground})}`,
    `html[data-booting] body{transition:none!important}`,
    `#startup-screen{display:flex;align-items:center;justify-content:center;height:100dvh;background-color:var(--color-background,${lightBackground})}`,
    `.dark #startup-screen{background-color:var(--color-background,${darkBackground})}`,
    `#startup-screen svg{width:5rem;height:5rem;color:var(--color-primary,${lightPrimary});animation:startup-logo-entrance .5s cubic-bezier(0.16,1,0.3,1) forwards}`,
    `.dark #startup-screen svg{color:var(--color-primary,${darkPrimary})}`,
    `@keyframes startup-logo-entrance{${keyframes.replace(/\s+/g, " ")}}`,
    `@media (prefers-reduced-motion: reduce){#startup-screen svg{animation:none;opacity:1}}`,
    `.startup-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}`,
  ].join("");

  const head = `<style>${style}</style><script>${bootScript}</script>`;

  const root =
    `<div id="startup-screen">` +
    `<svg aria-hidden="true" fill="currentColor" fill-rule="${logo.fillRule}" viewBox="${logo.viewBox}" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${logo.d}"/></svg>` +
    `<span class="startup-sr-only" role="status">Loading Maibuk</span>` +
    `</div>`;

  return { head, root };
}

/** Inserts the parts into an index.html string. */
export function applyStartupScreen(html, { head, root }) {
  const charset = /<meta\s+charset=["'][^"']*["']\s*\/?>/i.exec(html);
  if (!charset) fail("index.html has no <meta charset> to insert the startup screen after");
  let out = html.replace(charset[0], () => `${charset[0]}\n  ${head}`);

  if (!/<html\b/.test(out)) fail("index.html has no <html> tag to mark as booting");
  out = out.replace(/<html\b/, () => "<html data-booting");

  const rootTag = ROOT_MARKER.exec(out);
  if (!rootTag) fail('index.html has no empty <div id="root"></div> to fill');

  return out.replace(ROOT_MARKER, () => `<div id="root">${root}</div>`);
}

/**
 * Reads the sources on every call, so dev picks up edits to the logo, the
 * tokens, the keyframes, or the boot script without a Vite restart.
 */
export function startupScreenPlugin({ root }) {
  return {
    name: "maibuk-startup-screen",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const logo = extractLogoSvg(readFileSync(join(root, LOGO_SOURCE), "utf8"));
        const css = readFileSync(join(root, CSS_SOURCE), "utf8");
        const parts = renderStartupScreen({
          logo,
          tokens: extractTokenDefaults(css),
          keyframes: extractKeyframes(css, ENTRANCE_KEYFRAMES),
          bootScript: readFileSync(join(root, BOOT_SCRIPT_SOURCE), "utf8"),
        });
        return applyStartupScreen(html, parts);
      },
    },
  };
}
