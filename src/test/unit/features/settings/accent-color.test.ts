import { afterEach, describe, expect, it } from "vitest";
import { applyAccentColor } from "@/features/settings/accent-color";

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
