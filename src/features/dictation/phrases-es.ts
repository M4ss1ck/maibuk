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
  {
    phrase: "signo de interrogación",
    entry: { actions: [{ kind: "mark", mark: "?" }], punctuation: true },
  },
  {
    phrase: "cierra interrogación",
    entry: { actions: [{ kind: "mark", mark: "?" }], punctuation: true },
  },
  {
    phrase: "abre interrogación",
    entry: { actions: [{ kind: "mark", mark: "¿" }], punctuation: true },
  },
  {
    phrase: "signo de exclamación",
    entry: { actions: [{ kind: "mark", mark: "!" }], punctuation: true },
  },
  {
    phrase: "cierra exclamación",
    entry: { actions: [{ kind: "mark", mark: "!" }], punctuation: true },
  },
  {
    phrase: "abre exclamación",
    entry: { actions: [{ kind: "mark", mark: "¡" }], punctuation: true },
  },
  { phrase: "abre comillas", entry: { actions: [{ kind: "mark", mark: "«" }], punctuation: true } },
  { phrase: "cierra comillas", entry: { actions: [{ kind: "mark", mark: "»" }], punctuation: true } },
  {
    phrase: "abre paréntesis",
    entry: { actions: [{ kind: "mark", mark: "(" }], punctuation: true },
  },
  {
    phrase: "cierra paréntesis",
    entry: { actions: [{ kind: "mark", mark: ")" }], punctuation: true },
  },
  { phrase: "nuevo párrafo", entry: { actions: [{ kind: "paragraph" }], punctuation: false } },
  { phrase: "nueva línea", entry: { actions: [{ kind: "line_break" }], punctuation: false } },
  { phrase: "nuevo elemento", entry: { actions: [{ kind: "list_item" }], punctuation: false } },
  { phrase: "mayúscula", entry: { actions: [{ kind: "cap" }], punctuation: false } },
  { phrase: "literal", entry: { actions: [{ kind: "literal" }], punctuation: false } },
];
