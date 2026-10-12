import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

// These warnings once promised things the code never did ("Your original data
// was not modified", "delete all books, chapters, and settings"). Each
// assertion pins a fact checked against the code it describes.

describe("destructive action warnings", () => {
  it("Reset keeps app settings and names what a safety backup cannot bring back", () => {
    // resetDatabase() clears the database only; app settings live in local
    // storage. Backups do not carry metrics, and restore skips cover templates.
    expect(en.settings.resetDatabaseConfirm).toContain("Your settings are kept.");
    expect(en.settings.resetDatabaseConfirm).toContain(
      "writing metrics, cover templates, and imported EPUB details can't be recovered"
    );
    expect(es.settings.resetDatabaseConfirm).toContain("Tu configuración se mantiene.");
    expect(es.settings.resetDatabaseConfirm).toContain(
      "las métricas de escritura, las plantillas de portada y los datos de EPUB importados no se pueden recuperar"
    );
  });

  it("Restore says Canvases are only replaced when the backup includes them", () => {
    expect(en.backup.restoreConfirm).toContain("canvases too when the backup includes them");
    expect(es.backup.restoreConfirm).toContain("también los lienzos si la copia los incluye");
  });

  it("Reset settings names what it clears and what it keeps", () => {
    // resetAllSettings clears the settings store, Shortcuts, approvals, and
    // credentials; it never touches Plugin files or Library data.
    expect(en.settings.resetBody).toContain("Saved credentials are deleted.");
    expect(en.settings.resetBody).toContain("Installed Plugin files and Library data stay.");
    expect(en.settings.resetBody).toContain("Third-party Plugins need approval again.");
    expect(es.settings.resetBody).toContain("Se borran las credenciales guardadas.");
    expect(es.settings.resetBody).toContain(
      "Se conservan los archivos de Plugins y los datos de la Biblioteca."
    );
    expect(es.settings.resetBody).toContain(
      "Los Plugins de terceros requieren aprobación de nuevo."
    );
  });

  it("a failed restore does not claim the library is untouched", () => {
    // replaceRestoreData deletes before it inserts, so a failure can leave a
    // partial library; the Pre-restore backup is the way back.
    for (const message of [en.backup.restoreFailed, es.backup.restoreFailed]) {
      expect(message).not.toMatch(/not modified|no fueron modificados/i);
    }
    expect(en.backup.restoreFailed).toContain(`"${en.backup.trigger["pre-restore"]}"`);
    expect(es.backup.restoreFailed).toContain(`"${es.backup.trigger["pre-restore"]}"`);
  });
});
