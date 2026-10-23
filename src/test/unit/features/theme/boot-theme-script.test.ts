import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOT_THEME_KEY } from "@/features/theme/boot-theme";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/features/theme/boot-theme-script.js"),
  "utf8"
);

const originalMatchMedia = window.matchMedia;

function runScript(): void {
  new Function(SOURCE)();
}

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

function storeRecord(record: unknown): void {
  localStorage.setItem(BOOT_THEME_KEY, JSON.stringify(record));
}

function setPrefersDark(matches: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe("boot-theme-script", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("style");
    window.matchMedia = originalMatchMedia;
    setPrefersDark(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.matchMedia = originalMatchMedia;
    window.history.replaceState(null, "", "/");
    document.documentElement.removeAttribute("style");
  });

  it("stays small enough to inline", () => {
    expect(Buffer.byteLength(SOURCE, "utf8")).toBeLessThan(1500);
  });

  it("applies a light record even when the system prefers dark", () => {
    setPrefersDark(true);
    storeRecord({ v: 1, mode: "light", vars: {} });
    runScript();
    expect(isDark()).toBe(false);
  });

  it("applies a dark record even when the system prefers light", () => {
    storeRecord({ v: 1, mode: "dark", vars: {} });
    runScript();
    expect(isDark()).toBe(true);
  });

  it("follows the system preference for a system record that prefers dark", () => {
    setPrefersDark(true);
    storeRecord({ v: 1, mode: "system", vars: {} });
    runScript();
    expect(isDark()).toBe(true);
  });

  it("follows the system preference for a system record that prefers light", () => {
    document.documentElement.classList.add("dark");
    setPrefersDark(false);
    storeRecord({ v: 1, mode: "system", vars: {} });
    runScript();
    expect(isDark()).toBe(false);
  });

  it("applies custom variable overrides and ignores non-custom keys", () => {
    storeRecord({
      v: 1,
      mode: "dark",
      vars: { "--color-primary": "#123456", "not-a-variable": "red" },
    });
    runScript();
    expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe("#123456");
    expect(document.documentElement.style.getPropertyValue("not-a-variable")).toBe("");
  });

  it("falls back to the system preference with no record", () => {
    setPrefersDark(true);
    runScript();
    expect(isDark()).toBe(true);
  });

  it("ignores malformed JSON", () => {
    localStorage.setItem(BOOT_THEME_KEY, "{not json");
    setPrefersDark(false);
    runScript();
    expect(isDark()).toBe(false);
  });

  it("ignores a record from another version", () => {
    storeRecord({ v: 2, mode: "dark", vars: {} });
    runScript();
    expect(isDark()).toBe(false);
  });

  it("ignores a record whose vars is not an object", () => {
    storeRecord({ v: 1, mode: "dark", vars: "nope" });
    runScript();
    expect(isDark()).toBe(false);
  });

  it("survives localStorage access throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setPrefersDark(true);
    expect(() => runScript()).not.toThrow();
    expect(isDark()).toBe(true);
  });

  it("survives a missing matchMedia", () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    document.documentElement.classList.add("dark");
    storeRecord({ v: 1, mode: "system", vars: {} });
    expect(() => runScript()).not.toThrow();
    expect(isDark()).toBe(false);
  });

  it("leaves the document untouched on the Embed route", () => {
    window.history.replaceState(null, "", "/embed");
    document.documentElement.classList.add("dark");
    document.documentElement.style.setProperty("--color-primary", "#abcdef");
    storeRecord({ v: 1, mode: "light", vars: { "--color-primary": "#000000" } });
    runScript();
    expect(isDark()).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe("#abcdef");
  });
});
