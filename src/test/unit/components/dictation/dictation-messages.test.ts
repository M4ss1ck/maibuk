import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { noticeMessage } from "@/components/dictation/dictation-messages";

const t = i18n.getFixedT("en");

describe("noticeMessage()", () => {
  it("announces start with the language name", () => {
    expect(noticeMessage({ kind: "started", language: "es" }, t)).toEqual({
      announce: "Dictation on, Spanish",
    });
  });
  it("announces stop", () => {
    expect(noticeMessage({ kind: "stopped" }, t)).toEqual({
      announce: "Dictation off",
    });
  });
  it("turns an error into an error toast and an announcement", () => {
    const message = noticeMessage({ kind: "error", code: "model_missing", language: "es" }, t);
    expect(message.toast).toEqual({
      variant: "error",
      text: "No Spanish dictation model is downloaded. Download one in Settings → Dictation.",
    });
    expect(message.announce).toBe(message.toast?.text);
  });
  it("treats no_target as a hint, not an error", () => {
    expect(noticeMessage({ kind: "error", code: "no_target" }, t).toast?.variant).toBe("info");
  });
  it("treats cancelled as a hint, not an error", () => {
    expect(noticeMessage({ kind: "error", code: "cancelled" }, t).toast?.variant).toBe("info");
  });
  it("announces a refused scratch without a toast", () => {
    const message = noticeMessage({ kind: "scratch_refused" }, t);
    expect(message.toast).toBeUndefined();
    expect(message.announce).toBe(
      "Nothing removed. Scratch that only removes text that hasn't been edited."
    );
  });
  it("announces a refused scratch in Spanish", () => {
    const es = i18n.getFixedT("es");
    expect(noticeMessage({ kind: "scratch_refused" }, es).announce).toBe(
      "No se eliminó nada. Borra eso solo elimina texto que no ha sido editado."
    );
  });
  it("announces an empty scratch without a toast", () => {
    const message = noticeMessage({ kind: "scratch_empty" }, t);
    expect(message.toast).toBeUndefined();
    expect(message.announce).toBe("Nothing to remove.");
  });
  it("announces an empty scratch in Spanish", () => {
    const es = i18n.getFixedT("es");
    expect(noticeMessage({ kind: "scratch_empty" }, es).announce).toBe("No hay nada que borrar.");
  });
  it("announces a refused voice that without a toast", () => {
    const message = noticeMessage({ kind: "voice_that_refused" }, t);
    expect(message.toast).toBeUndefined();
    expect(message.announce).toBe(
      "Nothing changed. That only reaches dictated text that hasn't been edited."
    );
  });
  it("announces a refused voice that in Spanish", () => {
    const es = i18n.getFixedT("es");
    expect(noticeMessage({ kind: "voice_that_refused" }, es).announce).toBe(
      "No se cambió nada. Eso solo alcanza texto dictado que no se ha editado."
    );
  });
  it("announces an empty voice that without a toast", () => {
    const message = noticeMessage({ kind: "voice_that_empty" }, t);
    expect(message.toast).toBeUndefined();
    expect(message.announce).toBe("Nothing dictated to change.");
  });
  it("announces an empty voice that in Spanish", () => {
    const es = i18n.getFixedT("es");
    expect(noticeMessage({ kind: "voice_that_empty" }, es).announce).toBe(
      "No hay nada dictado que cambiar."
    );
  });
  it("announces a Voice Command with the Command's label and its polarity", () => {
    expect(
      noticeMessage({ kind: "voice_command", id: "editor.bold", polarity: "on" }, t).announce
    ).toBe("Bold on");
    expect(
      noticeMessage({ kind: "voice_command", id: "editor.bold", polarity: "off" }, t).announce
    ).toBe("Bold off");
    expect(
      noticeMessage({ kind: "voice_command", id: "common.undo", polarity: null }, t).announce
    ).toBe("Voice command: Undo");
  });
  it("announces a Voice Command in Spanish", () => {
    const es = i18n.getFixedT("es");
    expect(
      noticeMessage({ kind: "voice_command", id: "editor.bold", polarity: "on" }, es).announce
    ).toBe("Se activó Negrita");
    expect(
      noticeMessage({ kind: "voice_command", id: "editor.bold", polarity: "off" }, es).announce
    ).toBe("Se desactivó Negrita");
    expect(
      noticeMessage({ kind: "voice_command", id: "dictation.stop", polarity: null }, es).announce
    ).toBe("Comando de voz: Detener dictado");
  });
  it("announces an unavailable voice command with the Command's label", () => {
    expect(
      noticeMessage({ kind: "voice_command_unavailable", id: "editor.bold" }, t).announce
    ).toBe("Bold is not available here.");
  });
  it("announces an unavailable voice command in Spanish", () => {
    const es = i18n.getFixedT("es");
    expect(
      noticeMessage({ kind: "voice_command_unavailable", id: "editor.bold" }, es).announce
    ).toBe("Negrita no está disponible aquí.");
  });
  it("announces a dialog-refused voice command with the Command's label", () => {
    expect(
      noticeMessage({ kind: "voice_command_refused", id: "editor.bold", reason: "dialog" }, t)
        .announce
    ).toBe("Close the dialog to use Bold.");
  });
  it("announces a dialog-refused voice command in Spanish", () => {
    const es = i18n.getFixedT("es");
    expect(
      noticeMessage({ kind: "voice_command_refused", id: "editor.bold", reason: "dialog" }, es)
        .announce
    ).toBe("Cierra el diálogo para usar Negrita.");
  });
  it("announces a tutorial-refused voice command with the Command's label", () => {
    expect(
      noticeMessage({ kind: "voice_command_refused", id: "editor.bold", reason: "tutorial" }, t)
        .announce
    ).toBe("Bold is not available during the Tutorial.");
  });
  it("announces a tutorial-refused voice command in Spanish", () => {
    const es = i18n.getFixedT("es");
    expect(
      noticeMessage({ kind: "voice_command_refused", id: "editor.bold", reason: "tutorial" }, es)
        .announce
    ).toBe("Negrita no está disponible durante el Tutorial.");
  });
  it("announces a stuck-dialog refusal with the Command's label", () => {
    expect(
      noticeMessage(
        { kind: "voice_command_refused", id: "editor.bold", reason: "dialog_refused" },
        t
      ).announce
    ).toBe("The dialog can't close now, so Bold did not run.");
  });
  it("announces a stuck-dialog refusal in Spanish", () => {
    const es = i18n.getFixedT("es");
    expect(
      noticeMessage(
        { kind: "voice_command_refused", id: "editor.bold", reason: "dialog_refused" },
        es
      ).announce
    ).toBe("El diálogo no puede cerrarse ahora, así que Negrita no se ejecutó.");
  });
  it("announces nothing to undo or redo", () => {
    expect(noticeMessage({ kind: "voice_command_empty", id: "common.undo" }, t)).toEqual({
      announce: "Nothing to undo.",
    });
    expect(noticeMessage({ kind: "voice_command_empty", id: "common.redo" }, t).announce).toBe(
      "Nothing to redo."
    );
  });
  it("announces nothing to undo or redo in Spanish", () => {
    const es = i18n.getFixedT("es");
    expect(noticeMessage({ kind: "voice_command_empty", id: "common.undo" }, es).announce).toBe(
      "No hay nada que deshacer."
    );
    expect(noticeMessage({ kind: "voice_command_empty", id: "common.redo" }, es).announce).toBe(
      "No hay nada que rehacer."
    );
  });
  it("announces the all-caps lock turning on and off (#271)", () => {
    expect(noticeMessage({ kind: "caps_lock", on: true }, t)).toEqual({
      announce: "All caps on",
    });
    expect(noticeMessage({ kind: "caps_lock", on: false }, t)).toEqual({
      announce: "All caps off",
    });
  });
  it("announces the all-caps lock in Spanish", () => {
    const es = i18n.getFixedT("es");
    expect(noticeMessage({ kind: "caps_lock", on: true }, es).announce).toBe(
      "Mayúsculas activadas"
    );
    expect(noticeMessage({ kind: "caps_lock", on: false }, es).announce).toBe(
      "Mayúsculas desactivadas"
    );
  });
  it("announces an orphan copied to the clipboard", () => {
    const message = noticeMessage({ kind: "orphan_copied" }, t);
    expect(message.toast?.variant).toBe("info");
    expect(message.announce).toBeTruthy();
  });
  it("shows the lost phrase when the clipboard refused", () => {
    const message = noticeMessage({ kind: "orphan_lost", text: "hola" }, t);
    expect(message.toast).toEqual({
      variant: "info",
      text: "Dictation stopped. Copy the last phrase: hola",
    });
    expect(message.announce).toBe(message.toast?.text);
  });
  it("announces a hand-off with no editor without a toast", () => {
    const message = noticeMessage({ kind: "handoff_no_editor" }, t);
    expect(message.toast).toBeUndefined();
    expect(message.announce).toBe("No editor here, so Dictation stopped.");
  });
  it("announces a hand-off with no editor in Spanish", () => {
    const es = i18n.getFixedT("es");
    expect(noticeMessage({ kind: "handoff_no_editor" }, es).announce).toBe(
      "Aquí no hay editor, así que el dictado se detuvo."
    );
  });
  it("announces a pressed click in both locales", () => {
    expect(noticeMessage({ kind: "click_pressed", name: "Export" }, t).announce).toBe(
      "Pressed Export."
    );
    const es = i18n.getFixedT("es");
    expect(noticeMessage({ kind: "click_pressed", name: "Exportar" }, es).announce).toBe(
      "Pulsado: Exportar."
    );
  });
  it("announces click choices in both locales", () => {
    expect(noticeMessage({ kind: "click_choices", count: 2 }, t).announce).toBe(
      "2 matches. Say click and a number."
    );
    const es = i18n.getFixedT("es");
    expect(noticeMessage({ kind: "click_choices", count: 2 }, es).announce).toBe(
      "2 coincidencias. Di pulsar y un número."
    );
  });
  it("announces a click with no match in both locales", () => {
    expect(noticeMessage({ kind: "click_not_found", name: "export" }, t).announce).toBe(
      "Nothing called export here."
    );
    const es = i18n.getFixedT("es");
    expect(noticeMessage({ kind: "click_not_found", name: "exportar" }, es).announce).toBe(
      "Aquí no hay nada llamado exportar."
    );
  });
  it("announces a refused password field in both locales", () => {
    expect(noticeMessage({ kind: "field_secret_refused" }, t).announce).toBe(
      "Dictation does not type into password fields."
    );
    const es = i18n.getFixedT("es");
    expect(noticeMessage({ kind: "field_secret_refused" }, es).announce).toBe(
      "El dictado no escribe en campos de contraseña."
    );
  });
  it("announces a dropped line break in both locales", () => {
    expect(noticeMessage({ kind: "field_layout_ignored" }, t).announce).toBe(
      "No line breaks in this field."
    );
    const es = i18n.getFixedT("es");
    expect(noticeMessage({ kind: "field_layout_ignored" }, es).announce).toBe(
      "Este campo no admite saltos de línea."
    );
  });
  it("covers every error code in both locales", async () => {
    const codes = [
      "mic_denied",
      "mic_unavailable",
      "model_missing",
      "model_corrupt",
      "download_failed",
      "disk_full",
      "model_gone",
      "engine_crashed",
      "unsupported",
      "tutorial_active",
      "no_target",
      "cancelled",
    ] as const;
    for (const lng of ["en", "es"]) {
      for (const code of codes) expect(i18n.exists(`dictation.errors.${code}`, { lng })).toBe(true);
    }
  });
});
