// Default English Spoken Punctuation entries. These are Dictation Language
// data, not UI copy: the words are what the model hears and what the author
// can switch off or extend in Settings → Dictation.
import type { SpokenPunctuationEntry } from "@/features/dictation/spoken-punctuation";

export const EN_ENTRIES: readonly SpokenPunctuationEntry[] = [
  { id: "comma", phrases: ["comma"], actions: [{ kind: "mark", mark: "," }], punctuation: true },
  { id: "period", phrases: ["period"], actions: [{ kind: "mark", mark: "." }], punctuation: true },
  {
    id: "questionMark",
    phrases: ["question mark"],
    actions: [{ kind: "mark", mark: "?" }],
    punctuation: true,
  },
  {
    id: "exclamationMark",
    phrases: ["exclamation mark", "exclamation point"],
    actions: [{ kind: "mark", mark: "!" }],
    punctuation: true,
  },
  { id: "colon", phrases: ["colon"], actions: [{ kind: "mark", mark: ":" }], punctuation: true },
  {
    id: "semicolon",
    phrases: ["semicolon"],
    actions: [{ kind: "mark", mark: ";" }],
    punctuation: true,
  },
  {
    id: "openQuote",
    phrases: ["open quote"],
    actions: [{ kind: "mark", mark: "“" }],
    punctuation: true,
  },
  {
    id: "closeQuote",
    phrases: ["close quote"],
    actions: [{ kind: "mark", mark: "”" }],
    punctuation: true,
  },
  {
    id: "openParenthesis",
    phrases: ["open parenthesis"],
    actions: [{ kind: "mark", mark: "(" }],
    punctuation: true,
  },
  {
    id: "closeParenthesis",
    phrases: ["close parenthesis"],
    actions: [{ kind: "mark", mark: ")" }],
    punctuation: true,
  },
  {
    id: "newParagraph",
    phrases: ["new paragraph"],
    actions: [{ kind: "paragraph" }],
    punctuation: false,
  },
  { id: "newLine", phrases: ["new line"], actions: [{ kind: "line_break" }], punctuation: false },
  { id: "newItem", phrases: ["new item"], actions: [{ kind: "list_item" }], punctuation: false },
  {
    id: "capitalize",
    phrases: ["capitalize"],
    actions: [{ kind: "cap" }],
    punctuation: false,
  },
  { id: "literal", phrases: ["literal"], actions: [{ kind: "literal" }], punctuation: false },
  {
    id: "scratchThat",
    phrases: ["scratch that"],
    actions: [{ kind: "scratch" }],
    punctuation: false,
  },
];
