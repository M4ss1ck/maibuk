// Default English recognizer phrases. Spoken punctuation marks are a later slice.
import type { PhraseDefinition } from "@/features/dictation/interpreter";

export const EN_PHRASES: readonly PhraseDefinition[] = [
  { phrase: "new paragraph", entry: { actions: [{ kind: "paragraph" }], punctuation: false } },
  { phrase: "new line", entry: { actions: [{ kind: "line_break" }], punctuation: false } },
];
