/** @jsxImportSource preact */
/**
 * The Reader component gallery (#943 unit 5). The gallery is a dev-only
 * screenshots page, so these tests prove two things the build must keep true:
 * every kit section and icon draws through the public Gallery, and the real
 * production Frame bundle never contains gallery code.
 *
 * The production proof bundles `frame/entry.ts` with esbuild in memory, the
 * same transform and production define `scripts/build-plugin.ts` uses. jsdom
 * swaps `Uint8Array`, `TextEncoder`, and `TextDecoder` for its own realm, which
 * trips esbuild's startup invariant, so the bundle helper puts Node's back for
 * the call and restores the environment immediately after.
 */

import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, sep } from "node:path";
import { TextDecoder, TextEncoder } from "node:util";
import { configure, getConfig, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentChild } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GALLERY_MARKER, Gallery } from "./gallery";
import { applyGalleryEnvironment, readGalleryEnvironment } from "./gallery-entry";
import { ICON_NAMES } from "./kit";

const PLUGIN_ROOT = join(__dirname, "..");
const containers: HTMLElement[] = [];
const nativeWidth = window.innerWidth;
const baseConfig = getConfig();

const SECTION_TITLES = [
  "Icons",
  "Buttons",
  "IconButtons",
  "Segmented",
  "Chips",
  "Switch",
  "Slider",
  "Sheet",
  "Popover",
  "Dialog",
  "Menu",
  "Cover tones",
  "ProgressCard",
  "Reading Themes",
  "Highlights",
];

const HIGHLIGHT_NAMES = ["yellow", "green", "blue", "pink", "purple"];

interface EsbuildBuildResult {
  outputFiles?: Array<{ path: string; text: string }>;
  metafile?: { inputs: Record<string, unknown> };
}

interface Esbuild {
  build(options: Record<string, unknown>): Promise<EsbuildBuildResult>;
}

/** Bundles one Frame module the way `scripts/build-plugin.ts` builds the Frame. */
async function bundleFrame(entryPoint: string): Promise<EsbuildBuildResult> {
  const saved = {
    Uint8Array: globalThis.Uint8Array,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
  };
  globalThis.Uint8Array = Object.getPrototypeOf(Buffer) as Uint8ArrayConstructor;
  globalThis.TextEncoder = TextEncoder as typeof globalThis.TextEncoder;
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
  try {
    const require = createRequire(import.meta.resolve("vite"));
    const esbuild = require("esbuild") as Esbuild;
    return await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "MaibukFrame",
      platform: "browser",
      target: "es2022",
      minify: true,
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      jsx: "automatic",
      jsxImportSource: "preact",
      jsxDev: false,
      metafile: true,
      logLevel: "silent",
    });
  } finally {
    globalThis.Uint8Array = saved.Uint8Array;
    globalThis.TextEncoder = saved.TextEncoder;
    globalThis.TextDecoder = saved.TextDecoder;
  }
}

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

async function mount(node: ComponentChild): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  await act(() => {
    render(node, container);
  });
  return container;
}

async function press(action: () => Promise<unknown>): Promise<void> {
  await act(async () => {
    await action();
  });
}

beforeEach(() => {
  setWidth(nativeWidth);
  configure({ asyncWrapper: async (callback) => callback() });
});

afterEach(async () => {
  await act(() => {
    for (const container of containers.splice(0)) {
      render(null, container);
      container.remove();
    }
  });
  configure({ asyncWrapper: baseConfig.asyncWrapper });
  setWidth(nativeWidth);
  const root = document.documentElement;
  for (const name of ["data-color-scheme", "data-eink", "data-motion", "data-reading-theme"]) {
    root.removeAttribute(name);
  }
  root.style.removeProperty("--maibuk-color-scheme");
  root.style.removeProperty("--maibuk-motion");
});

describe("Gallery", () => {
  it("draws every kit section under the gallery marker", async () => {
    const container = await mount(<Gallery />);

    expect(screen.getByRole("heading", { level: 1, name: GALLERY_MARKER })).toBeInTheDocument();
    for (const title of SECTION_TITLES) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }

    const icons = container.querySelectorAll("[data-icon-name]");
    expect(icons).toHaveLength(ICON_NAMES.length);
    expect(Array.from(icons, (icon) => icon.getAttribute("data-icon-name"))).toEqual(ICON_NAMES);
  });

  it("draws all eight Cover tones plus pending and missing covers", async () => {
    const container = await mount(<Gallery />);

    expect(container.querySelectorAll(".gallery-cover .kit-cover")).toHaveLength(10);
    const captions = container.querySelectorAll(".gallery-cover figcaption");
    expect(Array.from(captions, (caption) => caption.textContent)).toEqual([
      "Tone 1",
      "Tone 2",
      "Tone 3",
      "Tone 4",
      "Tone 5",
      "Tone 6",
      "Tone 7",
      "Tone 8",
      "Pending",
      "Missing",
    ]);
  });

  it("draws both ProgressCard states, four Reading Themes, and five Highlight rows", async () => {
    const container = await mount(<Gallery />);

    expect(container.querySelectorAll(".kit-progress-card")).toHaveLength(2);
    expect(screen.getByText("2 of 5")).toBeInTheDocument();
    expect(screen.getByText("5 of 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View report" })).toBeInTheDocument();

    const swatches = container.querySelectorAll(".gallery-theme-swatch");
    expect(swatches).toHaveLength(4);
    for (const theme of ["light", "sepia", "dark", "black"]) {
      expect(container.querySelector(`[data-reading-theme="${theme}"]`)).not.toBeNull();
    }

    expect(container.querySelectorAll(".gallery-highlight")).toHaveLength(HIGHLIGHT_NAMES.length);
    expect(container.querySelectorAll(".gallery-underline")).toHaveLength(HIGHLIGHT_NAMES.length);
  });

  it("keeps its local controls working for screenshots", async () => {
    const user = userEvent.setup({ delay: null });
    await mount(<Gallery />);

    const narrow = screen.getByRole("radio", { name: "Narrow" });
    expect(narrow).toHaveAttribute("aria-checked", "false");
    await press(() => user.click(narrow));
    expect(narrow).toHaveAttribute("aria-checked", "true");

    const filter = screen.getByRole("button", { name: "Fiction" });
    expect(filter).toHaveAttribute("aria-pressed", "true");
    await press(() => user.click(filter));
    expect(filter).toHaveAttribute("aria-pressed", "false");

    const showPages = screen.getByRole("switch", { name: "Show page numbers" });
    expect(showPages).toHaveAttribute("aria-checked", "true");
    await press(() => user.click(showPages));
    expect(showPages).toHaveAttribute("aria-checked", "false");

    expect(screen.getByText("100%")).toBeInTheDocument();
    await press(() => user.click(screen.getByRole("button", { name: "Increase font size" })));
    expect(screen.getByText("110%")).toBeInTheDocument();
  });

  it("opens the Sheet in Narrow and returns to the trigger on Escape", async () => {
    setWidth(500);
    const user = userEvent.setup({ delay: null });
    await mount(<Gallery />);

    const trigger = screen.getByRole("button", { name: "Open sheet" });
    await press(() => user.click(trigger));
    expect(screen.getByRole("dialog", { name: "Reading options" })).toBeInTheDocument();

    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("dialog", { name: "Reading options" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("opens the Dialog and Popover in Wide and closes them on Escape", async () => {
    setWidth(1024);
    const user = userEvent.setup({ delay: null });
    await mount(<Gallery />);

    const dialogTrigger = screen.getByRole("button", { name: "Open dialog" });
    await press(() => user.click(dialogTrigger));
    expect(screen.getByRole("dialog", { name: "Import report" })).toBeInTheDocument();
    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("dialog", { name: "Import report" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(dialogTrigger);

    const popoverTrigger = screen.getByRole("button", { name: "Open popover" });
    await press(() => user.click(popoverTrigger));
    expect(screen.getByRole("dialog", { name: "Look up" })).toBeInTheDocument();
    await press(() => user.keyboard("{Escape}"));
    expect(screen.queryByRole("dialog", { name: "Look up" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(popoverTrigger);
  });

  it("opens the Menu and records the chosen row", async () => {
    const user = userEvent.setup({ delay: null });
    await mount(<Gallery />);

    await press(() => user.click(screen.getByRole("button", { name: "Open menu" })));
    expect(screen.getByRole("menu", { name: "Document actions" })).toBeInTheDocument();

    await press(() => user.click(screen.getByRole("menuitem", { name: /Find in Document/ })));
    expect(screen.queryByRole("menu", { name: "Document actions" })).not.toBeInTheDocument();
    expect(screen.getByText("Chosen: Find in Document")).toBeInTheDocument();
  });
});

describe("gallery environment", () => {
  it("reads the theme, Reading Theme, E-ink, and motion query params", () => {
    expect(readGalleryEnvironment("?theme=dark&reading=sepia&motion=reduce")).toEqual({
      colorScheme: "dark",
      reading: "sepia",
      eink: false,
      motion: "reduce",
    });
    expect(readGalleryEnvironment("")).toEqual({
      colorScheme: "light",
      reading: "light",
      eink: false,
      motion: "no-preference",
    });
  });

  it("normalizes a non-black Reading Theme to light in E-ink Mode", () => {
    expect(readGalleryEnvironment("?reading=sepia&eink=1").reading).toBe("light");
    expect(readGalleryEnvironment("?reading=dark&eink=1").reading).toBe("light");
    expect(readGalleryEnvironment("?reading=black&eink=1").reading).toBe("black");
  });

  it("writes the Frame's document-root attributes and tokens", () => {
    const root = document.documentElement;
    applyGalleryEnvironment({
      colorScheme: "dark",
      reading: "sepia",
      eink: true,
      motion: "reduce",
    });

    expect(root.dataset.colorScheme).toBe("dark");
    expect(root.dataset.eink).toBe("true");
    expect(root.dataset.motion).toBe("reduce");
    expect(root.dataset.readingTheme).toBe("sepia");
    expect(root.style.getPropertyValue("--maibuk-color-scheme")).toBe("dark");
    expect(root.style.getPropertyValue("--maibuk-motion")).toBe("reduce");
  });
});

describe("production exclusion", () => {
  it("builds the real Frame entry without gallery code or gallery inputs", async () => {
    const entry = join(__dirname, "entry.ts");
    const result = await bundleFrame(entry);
    const text = result.outputFiles?.[0]?.text ?? "";

    expect(text.length).toBeGreaterThan(10_000);
    for (const galleryOnly of [
      GALLERY_MARKER,
      "Icon inventory",
      "Reading Theme swatches",
      "Highlight fills and E-ink underlines",
    ]) {
      expect(text).not.toContain(galleryOnly);
    }

    const galleryInputs = Object.keys(result.metafile?.inputs ?? {}).filter((path) =>
      /frame\/gallery(-entry)?\.tsx$/.test(path)
    );
    expect(galleryInputs).toEqual([]);
    expect(readFileSync(entry, "utf8")).not.toMatch(/gallery/i);
  });

  it("would catch gallery code, because the gallery entry bundles it", async () => {
    const result = await bundleFrame(join(__dirname, "gallery-entry.tsx"));
    const text = result.outputFiles?.[0]?.text ?? "";

    expect(text).toContain(GALLERY_MARKER);
    expect(text).toContain("Icon inventory");
  });

  it("keeps gallery.html and gallery.css outside assets/ and out of the manifest", () => {
    for (const name of ["gallery.html", "gallery.css"]) {
      const rootPath = join(PLUGIN_ROOT, name);
      expect(existsSync(rootPath)).toBe(true);
      expect(rootPath.startsWith(join(PLUGIN_ROOT, "assets") + sep)).toBe(false);
      expect(existsSync(join(PLUGIN_ROOT, "assets", name))).toBe(false);
    }

    const html = readFileSync(join(PLUGIN_ROOT, "gallery.html"), "utf8");
    expect(html).toContain('href="assets/ui/tokens.css"');
    expect(html).toContain('href="assets/ui/kit.css"');
    expect(html).toContain('href="gallery.css"');
    expect(html).toContain('src="./frame/gallery-entry.tsx"');

    expect(readFileSync(join(PLUGIN_ROOT, "manifest.json"), "utf8")).not.toContain("gallery");
  });
});
