import { afterEach, describe, expect, it } from "vitest";
import { accentColorVars, applyAccentColor } from "@/features/settings/accent-color";
import { BOOT_THEME_KEY } from "@/features/theme/boot-theme";

describe("applyAccentColor", () => {
  afterEach(() => document.documentElement.removeAttribute("style"));

  it("keeps text readable on the default and an arbitrary light or dark accent", () => {
    applyAccentColor("#3B82F6");
    expect(document.documentElement.style.getPropertyValue("--color-primary-foreground")).toBe(
      "#000000"
    );
    expect(
      document.documentElement.style.getPropertyValue("--color-primary-hover-foreground")
    ).toBe("#FFFFFF");
    applyAccentColor("#FFFF55");
    expect(document.documentElement.style.getPropertyValue("--color-primary-foreground")).toBe(
      "#000000"
    );
    applyAccentColor("#1E3A8A");
    expect(document.documentElement.style.getPropertyValue("--color-primary-foreground")).toBe(
      "#FFFFFF"
    );
  });
});

describe("accentColorVars", () => {
  it("returns the four primary properties applyAccentColor sets", () => {
    const vars = accentColorVars("#1E3A8A");
    expect(vars).toEqual({
      "--color-primary": "#1E3A8A",
      "--color-primary-hover": expect.any(String),
      "--color-primary-foreground": "#FFFFFF",
      "--color-primary-hover-foreground": expect.any(String),
    });
  });
});

describe("applyAccentColor preview", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("style");
    localStorage.clear();
  });

  it("does not write the boot theme snapshot", () => {
    localStorage.clear();
    applyAccentColor("#3B82F6");
    expect(localStorage.getItem(BOOT_THEME_KEY)).toBeNull();
  });
});
