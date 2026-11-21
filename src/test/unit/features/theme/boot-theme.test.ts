// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BOOT_THEME_KEY, writeBootTheme } from "@/features/theme/boot-theme";

function readSnapshot(): unknown {
  return JSON.parse(localStorage.getItem(BOOT_THEME_KEY) ?? "null");
}

describe("writeBootTheme()", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("writes the default record when nothing is stored", () => {
    writeBootTheme({});
    expect(readSnapshot()).toEqual({ v: 1, mode: "system", vars: {} });
  });

  it("merges mode then vars into the existing record", () => {
    writeBootTheme({ mode: "dark" });
    writeBootTheme({ vars: { "--color-primary": "#123456" } });
    expect(readSnapshot()).toEqual({
      v: 1,
      mode: "dark",
      vars: { "--color-primary": "#123456" },
    });
  });

  it("replaces vars as a whole rather than merging per key", () => {
    writeBootTheme({ vars: { "--color-primary": "#111111", "--keep": "no" } });
    writeBootTheme({ vars: { "--color-primary": "#222222" } });
    expect(readSnapshot()).toEqual({
      v: 1,
      mode: "system",
      vars: { "--color-primary": "#222222" },
    });
  });

  it("replaces a corrupt existing record", () => {
    localStorage.setItem(BOOT_THEME_KEY, "{not json");
    writeBootTheme({ mode: "light" });
    expect(readSnapshot()).toEqual({ v: 1, mode: "light", vars: {} });
  });

  it("replaces a record whose version is not 1", () => {
    localStorage.setItem(BOOT_THEME_KEY, JSON.stringify({ v: 2, mode: "dark", vars: {} }));
    writeBootTheme({ mode: "light" });
    expect(readSnapshot()).toEqual({ v: 1, mode: "light", vars: {} });
  });

  it("keeps only --prefixed string entries of vars", () => {
    localStorage.setItem(
      BOOT_THEME_KEY,
      JSON.stringify({
        v: 1,
        mode: "dark",
        vars: {
          "--color-primary": "#123456",
          "not-a-variable": "red",
          "--not-a-string": 3,
        },
      })
    );
    writeBootTheme({ mode: "light" });
    expect(readSnapshot()).toEqual({
      v: 1,
      mode: "light",
      vars: { "--color-primary": "#123456" },
    });
  });

  it("never throws when writing the record fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => writeBootTheme({ mode: "dark" })).not.toThrow();
  });

  it("round-trips E-ink Mode through later writes", () => {
    writeBootTheme({ eink: true });
    expect(readSnapshot()).toEqual({ v: 1, mode: "system", vars: {}, eink: true });
    writeBootTheme({ mode: "dark" });
    expect(readSnapshot()).toEqual({ v: 1, mode: "dark", vars: {}, eink: true });
  });

  it("reads a record without eink as off", () => {
    localStorage.setItem(BOOT_THEME_KEY, JSON.stringify({ v: 1, mode: "dark", vars: {} }));
    writeBootTheme({ mode: "light" });
    expect(readSnapshot()).toEqual({ v: 1, mode: "light", vars: {} });
  });

  it("keeps mode and vars from an old record when eink turns on", () => {
    localStorage.setItem(
      BOOT_THEME_KEY,
      JSON.stringify({ v: 1, mode: "dark", vars: { "--color-primary": "#123456" } })
    );
    writeBootTheme({ eink: true });
    expect(readSnapshot()).toEqual({
      v: 1,
      mode: "dark",
      vars: { "--color-primary": "#123456" },
      eink: true,
    });
  });

  it("reads a malformed eink as off without discarding mode or vars", () => {
    localStorage.setItem(
      BOOT_THEME_KEY,
      JSON.stringify({
        v: 1,
        mode: "dark",
        vars: { "--color-primary": "#123456" },
        eink: "yes",
      })
    );
    writeBootTheme({ mode: "light" });
    expect(readSnapshot()).toEqual({
      v: 1,
      mode: "light",
      vars: { "--color-primary": "#123456" },
    });
  });

  it("leaves eink out again when it turns off", () => {
    writeBootTheme({ eink: true });
    writeBootTheme({ eink: false });
    expect(readSnapshot()).toEqual({ v: 1, mode: "system", vars: {} });
  });
});
