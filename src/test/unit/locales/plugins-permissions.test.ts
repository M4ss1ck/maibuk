import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

// The Plugin permission copy (#442): the prototype's dictionary (PR #410, map
// section 3) in both languages, plus the authored plain-language rows for
// `library:write`, `editor:write`, and `clipboard`.

describe("Plugin permission copy", () => {
  it("names the approval and revocation actions in both locales", () => {
    expect(en.plugins.permissions.approve).toBe("Approve this copy and enable");
    expect(es.plugins.permissions.approve).toBe("Aprobar esta copia y activar");
    expect(en.plugins.permissions.revokeRequired).toBe("Disable Plugin and revoke access");
    expect(es.plugins.permissions.revokeRequired).toBe("Desactivar Plugin y revocar acceso");
    expect(en.plugins.permissions.requiredLabel).toBe("Required to enable this Plugin");
    expect(es.plugins.permissions.requiredLabel).toBe("Obligatorio para activar este Plugin");
    expect(en.plugins.permissions.optionalLabel).toBe("Optional");
    expect(es.plugins.permissions.optionalLabel).toBe("Opcional");
  });

  it("carries the responsibility, custom-UI, and requiredMissing notices", () => {
    for (const locale of [en, es]) {
      expect(locale.plugins.permissions.responsibility.length).toBeGreaterThan(0);
      expect(locale.plugins.permissions.frame.length).toBeGreaterThan(0);
      expect(locale.plugins.permissions.requiredMissing.length).toBeGreaterThan(0);
    }
    expect(en.plugins.permissions.requiredMissing).toContain("Required access is missing");
    expect(es.plugins.permissions.requiredMissing).toContain("Falta un permiso obligatorio");
  });

  it("interpolates the network host in both locales", () => {
    expect(en.plugins.permissions.network).toBe("Connect to {{host}}");
    expect(es.plugins.permissions.network).toBe("Conectarse a {{host}}");
  });

  it("covers every plain-language permission row in both locales", () => {
    const keys = [
      "read",
      "libraryWrite",
      "editorRead",
      "editorWrite",
      "decorate",
      "secrets",
      "clipboard",
      "process",
    ] as const;
    for (const key of keys) {
      expect(en.plugins.permissions[key].length, key).toBeGreaterThan(0);
      expect(es.plugins.permissions[key].length, key).toBeGreaterThan(0);
      expect(en.plugins.permissions[`${key}Detail`].length, key).toBeGreaterThan(0);
      expect(es.plugins.permissions[`${key}Detail`].length, key).toBeGreaterThan(0);
    }
    expect(en.plugins.permissions.process).toBe("Run programs on your computer");
    expect(es.plugins.permissions.process).toBe("Ejecutar programas en tu equipo");
    expect(en.plugins.permissions.read).toBe("Read your Library");
    expect(es.plugins.permissions.read).toBe("Leer tu Biblioteca");
  });

  it("uses the prototype's typographic apostrophes and first/grantIntro copy", () => {
    // PR #410's dictionary writes a typographic apostrophe, not a straight one.
    expect(en.plugins.permissions.responsibility).toContain("Plugin’s code");
    expect(en.plugins.permissions.responsibility).not.toContain("Plugin's");
    expect(en.plugins.permissions.processDetail).toContain("Maibuk’s Library");
    expect(en.plugins.permissions.processDetail).not.toContain("Maibuk's");
    expect(en.plugins.permissions.first).toBe(
      "Required permissions must be accepted to enable this Plugin. Optional permissions can stay off. No access is granted until you approve."
    );
    expect(es.plugins.permissions.first).toBe(
      "Debes aceptar los permisos obligatorios para activar este Plugin. Los opcionales se pueden denegar. No se concede acceso hasta que apruebes."
    );
    expect(en.plugins.permissions.grantIntro).toBe(
      "Optional permissions can be changed independently. Revoking required access disables this Plugin. Enabling it again requires approval of that access."
    );
    expect(es.plugins.permissions.grantIntro).toBe(
      "Los permisos opcionales se pueden cambiar por separado. Revocar un permiso obligatorio desactiva este Plugin. Para volver a activarlo debes aprobar ese acceso."
    );
  });

  it("names the row badges, states, and actions in both locales", () => {
    for (const locale of [en, es]) {
      expect(locale.plugins.builtInBadge.length).toBeGreaterThan(0);
      expect(locale.plugins.reviewRequired.length).toBeGreaterThan(0);
      expect(locale.plugins.status.enabled.length).toBeGreaterThan(0);
      expect(locale.plugins.status.off.length).toBeGreaterThan(0);
      expect(locale.plugins.enable.length).toBeGreaterThan(0);
      expect(locale.plugins.disable.length).toBeGreaterThan(0);
      expect(locale.plugins.reviewEnable.length).toBeGreaterThan(0);
      expect(locale.plugins.openSettings.length).toBeGreaterThan(0);
    }
    expect(en.plugins.reviewRequired).toBe("Review required");
    expect(es.plugins.reviewRequired).toBe("Revisión pendiente");
    expect(en.plugins.reviewEnable).toBe("Review and enable");
    expect(es.plugins.reviewEnable).toBe("Revisar y activar");
  });
});
