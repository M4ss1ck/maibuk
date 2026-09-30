import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TutorialIllustration } from "@/components/tutorial/TutorialIllustration";
import {
  buildPhraseTable,
  interpret,
  INITIAL_INTERPRETER_STATE,
} from "@/features/dictation/interpreter";
import { catalogCapabilities } from "@/features/dictation/spoken-punctuation";
import { normalizePhrase } from "@/features/dictation/normalize";
import { buildVoiceCommandTable, matchVoiceCommand } from "@/features/dictation/voice-commands";
import i18n from "@/i18n";
import "@/i18n";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

// The illustration is copy the interpreter must actually produce (no
// microphone, no model): the same Spoken Punctuation table a session builds
// turns the spoken line into the written one. The English model punctuates
// itself, so its side of the pair is a line the model would write.

const STATE = INITIAL_INTERPRETER_STATE;

function run(language: "en" | "es", line: string, before = "") {
  const capabilities = catalogCapabilities(language);
  return interpret({
    line,
    before,
    capabilities,
    table: buildPhraseTable(language, { capabilities }),
    state: STATE,
  });
}

describe("the Dictation illustration's copy", () => {
  it("writes the Spanish spoken line as the illustration's written line", () => {
    const { spoken, written } = es.tutorial.illustrations.dictation;
    expect(run("es", spoken).result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: written }],
    });
  });

  it("leaves the English model's line alone and says so where it punctuates itself", () => {
    const { written } = en.tutorial.illustrations.dictation;
    expect(catalogCapabilities("en").punctuation).toBe(true);
    expect(run("en", written).result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: written }],
    });
  });

  // The English copy names both a spoken break and "scratch that".
  it("turns an English spoken break into a paragraph, not the words", () => {
    expect(run("en", "Hello, how are you? New paragraph.").result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "Hello, how are you?" }, { kind: "paragraph" }],
    });
  });

  it("removes the last dictated sentence for Scratch that, never the typed text", () => {
    expect(run("en", "Scratch that.", "It was late.").result).toEqual({ kind: "scratch" });
  });

  it("names real default Voice Commands in both locales", () => {
    const enTable = buildVoiceCommandTable("en");
    expect(matchVoiceCommand(enTable, normalizePhrase("undo that").split(" "))?.id).toBe(
      "common.undo"
    );
    const esTable = buildVoiceCommandTable("es");
    expect(matchVoiceCommand(esTable, normalizePhrase("poner negrita").split(" "))?.id).toBe(
      "editor.bold"
    );
  });
});

describe("TutorialIllustration", () => {
  afterEach(async () => {
    await act(() => i18n.changeLanguage("en"));
  });

  it("renders the dictation figure with its label in English", () => {
    render(<TutorialIllustration id="dictation" />);
    expect(
      screen.getByRole("img", { name: en.tutorial.illustrations.dictation.label })
    ).toBeInTheDocument();
  });

  it("renders the dictation figure with its label in Spanish", async () => {
    await act(() => i18n.changeLanguage("es"));
    render(<TutorialIllustration id="dictation" />);
    expect(
      screen.getByRole("img", { name: es.tutorial.illustrations.dictation.label })
    ).toBeInTheDocument();
  });
});
