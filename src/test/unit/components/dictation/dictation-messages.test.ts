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
    const message = noticeMessage(
      { kind: "error", code: "model_missing", language: "es" },
      t,
    );
    expect(message.toast).toEqual({
      variant: "error",
      text: "No Spanish dictation model is downloaded. Download one in Settings → Dictation.",
    });
    expect(message.announce).toBe(message.toast?.text);
  });
  it("treats no_target as a hint, not an error", () => {
    expect(
      noticeMessage({ kind: "error", code: "no_target" }, t).toast?.variant,
    ).toBe("info");
  });
  it("treats cancelled as a hint, not an error", () => {
    expect(
      noticeMessage({ kind: "error", code: "cancelled" }, t).toast?.variant,
    ).toBe("info");
  });
  it("announces a refused scratch without a toast", () => {
    const message = noticeMessage({ kind: "scratch_refused" }, t);
    expect(message.toast).toBeUndefined();
    expect(message.announce).toBe("Nothing removed. Scratch that only removes text that hasn't been edited.");
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
    expect(noticeMessage({ kind: "scratch_empty" }, es).announce).toBe(
      "No hay nada que borrar."
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
      for (const code of codes)
        expect(i18n.exists(`dictation.errors.${code}`, { lng })).toBe(true);
    }
  });
});
