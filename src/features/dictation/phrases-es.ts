// Default Spanish recognizer phrases. These are Dictation Language data, not UI copy.
import type { PhraseDefinition } from "@/features/dictation/interpreter";

export const ES_PHRASES: readonly PhraseDefinition[] = [
  { phrase: "coma", entry: { actions: [{ kind: "mark", mark: "," }], punctuation: true } },
  { phrase: "punto", entry: { actions: [{ kind: "mark", mark: "." }], punctuation: true } },
  { phrase: "punto y seguido", entry: { actions: [{ kind: "mark", mark: "." }], punctuation: true } },
  {
    phrase: "punto y aparte",
    entry: { actions: [{ kind: "mark", mark: "." }, { kind: "paragraph" }], punctuation: true },
  },
  { phrase: "dos puntos", entry: { actions: [{ kind: "mark", mark: ":" }], punctuation: true } },
  { phrase: "punto y coma", entry: { actions: [{ kind: "mark", mark: ";" }], punctuation: true } },
  {
    phrase: "puntos suspensivos",
    entry: { actions: [{ kind: "mark", mark: "…" }], punctuation: true },
  },
  { phrase: "nuevo párrafo", entry: { actions: [{ kind: "paragraph" }], punctuation: false } },
  { phrase: "nueva línea", entry: { actions: [{ kind: "line_break" }], punctuation: false } },
];
