import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

// The changed-files review copy (#442): the prototype's dictionary (PR #410, map
// section 3) for the per-file and permission diff, plus the authored "Older
// version" and Development mode strings (flagged as new).

describe("Plugin review copy", () => {
  it("names the file and permission diff states in both locales", () => {
    expect(en.plugins.added).toBe("Added");
    expect(es.plugins.added).toBe("Añadido");
    expect(en.plugins.removed).toBe("Removed");
    expect(es.plugins.removed).toBe("Eliminado");
    expect(en.plugins.unchanged).toBe("Unchanged");
    expect(es.plugins.unchanged).toBe("Sin cambios");
    expect(en.plugins.nowRequired).toBe("Now required");
    expect(es.plugins.nowRequired).toBe("Ahora obligatorio");
    // "Changed" is authored: the prototype has no changed-file label.
    expect(en.plugins.changed).toBe("Changed");
    expect(es.plugins.changed).toBe("Modificado");
  });

  it("carries the noChanges copy and the authored Older version label", () => {
    expect(en.plugins.noChanges).toContain("No permission changes");
    expect(es.plugins.noChanges).toContain("Los permisos no cambiaron");
    // "Older version" is absent from the prototype dictionary; authored here.
    expect(en.plugins.olderVersion).toBe("Older version");
    expect(es.plugins.olderVersion).toBe("Versión anterior");
  });

  it("names Development mode and its help in both locales", () => {
    for (const locale of [en, es]) {
      expect(locale.plugins.developmentMode.length).toBeGreaterThan(0);
      expect(locale.plugins.developmentModeHelp.length).toBeGreaterThan(0);
    }
    expect(en.plugins.developmentMode).toBe("Development mode");
    expect(es.plugins.developmentMode).toBe("Modo de desarrollo");
  });

  it("carries a localized startup-error sentence per code plus a generic", () => {
    const keys = [
      "incompatible",
      "manifestInvalid",
      "moduleRefused",
      "hashMismatch",
      "startupTimeout",
      "dataNewer",
      "generic",
    ] as const;
    for (const locale of [en, es]) {
      for (const key of keys) {
        expect(locale.plugins.startupError[key].length, key).toBeGreaterThan(0);
      }
    }
    expect(en.plugins.startupError.generic).toBe("This Plugin failed to start.");
    expect(es.plugins.startupError.generic).toBe("Este Plugin no pudo iniciarse.");
  });
});
