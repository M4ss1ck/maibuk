import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import es from "../../../locales/es.json";

describe("shortcut locale labels", () => {
  it("clarifies that version history opens outside the editor", () => {
    expect(en.shortcuts.versionHistory).toBe("Version history (outside editor)");
    expect(es.shortcuts.versionHistory).toBe("Historial de versiones (fuera del editor)");
  });
});
