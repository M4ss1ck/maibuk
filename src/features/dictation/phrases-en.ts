// Default English recognizer phrases. These are Dictation Language data, not UI copy.
import type { PhraseDefinition } from "@/features/dictation/interpreter";

export const EN_PHRASES: readonly PhraseDefinition[] = [
  { phrase: "comma", entry: { actions: [{ kind: "mark", mark: "," }], punctuation: true } },
  { phrase: "period", entry: { actions: [{ kind: "mark", mark: "." }], punctuation: true } },
  {
    phrase: "question mark",
    entry: { actions: [{ kind: "mark", mark: "?" }], punctuation: true },
  },
  {
    phrase: "exclamation mark",
    entry: { actions: [{ kind: "mark", mark: "!" }], punctuation: true },
  },
  {
    phrase: "exclamation point",
    entry: { actions: [{ kind: "mark", mark: "!" }], punctuation: true },
  },
  { phrase: "colon", entry: { actions: [{ kind: "mark", mark: ":" }], punctuation: true } },
  { phrase: "semicolon", entry: { actions: [{ kind: "mark", mark: ";" }], punctuation: true } },
  { phrase: "new paragraph", entry: { actions: [{ kind: "paragraph" }], punctuation: false } },
  { phrase: "new line", entry: { actions: [{ kind: "line_break" }], punctuation: false } },
  { phrase: "new item", entry: { actions: [{ kind: "list_item" }], punctuation: false } },
  { phrase: "open quote", entry: { actions: [{ kind: "mark", mark: "“" }], punctuation: true } },
  { phrase: "close quote", entry: { actions: [{ kind: "mark", mark: "”" }], punctuation: true } },
  {
    phrase: "open parenthesis",
    entry: { actions: [{ kind: "mark", mark: "(" }], punctuation: true },
  },
  {
    phrase: "close parenthesis",
    entry: { actions: [{ kind: "mark", mark: ")" }], punctuation: true },
  },
  { phrase: "capitalize", entry: { actions: [{ kind: "cap" }], punctuation: false } },
  { phrase: "literal", entry: { actions: [{ kind: "literal" }], punctuation: false } },
];
