// Default Spanish Spoken Punctuation entries. These are Dictation Language
// data, not UI copy: the words are what the model hears and what the author
// can switch off or extend in Settings → Dictation.
import type { SpokenPunctuationEntry } from "@/features/dictation/spoken-punctuation";

export const ES_ENTRIES: readonly SpokenPunctuationEntry[] = [
  { id: "coma", phrases: ["coma"], actions: [{ kind: "mark", mark: "," }], punctuation: true },
  {
    id: "punto",
    phrases: ["punto", "punto y seguido"],
    actions: [{ kind: "mark", mark: "." }],
    punctuation: true,
  },
  {
    id: "puntoYAparte",
    phrases: ["punto y aparte"],
    actions: [{ kind: "mark", mark: "." }, { kind: "paragraph" }],
    punctuation: true,
  },
  {
    id: "dosPuntos",
    phrases: ["dos puntos"],
    actions: [{ kind: "mark", mark: ":" }],
    punctuation: true,
  },
  {
    id: "puntoYComa",
    phrases: ["punto y coma"],
    actions: [{ kind: "mark", mark: ";" }],
    punctuation: true,
  },
  {
    id: "puntosSuspensivos",
    phrases: ["puntos suspensivos"],
    actions: [{ kind: "mark", mark: "…" }],
    punctuation: true,
  },
  {
    id: "signoDeInterrogacion",
    phrases: ["signo de interrogación", "cierra interrogación"],
    heard: { "cierre interrogación": "cierra interrogación" },
    actions: [{ kind: "mark", mark: "?" }],
    punctuation: true,
  },
  {
    id: "abreInterrogacion",
    phrases: ["abre interrogación"],
    actions: [{ kind: "mark", mark: "¿" }],
    punctuation: true,
  },
  {
    id: "signoDeExclamacion",
    phrases: ["signo de exclamación", "cierra exclamación"],
    heard: { "cierre exclamación": "cierra exclamación" },
    actions: [{ kind: "mark", mark: "!" }],
    punctuation: true,
  },
  {
    id: "abreExclamacion",
    phrases: ["abre exclamación"],
    actions: [{ kind: "mark", mark: "¡" }],
    punctuation: true,
  },
  {
    id: "abreComillas",
    phrases: ["abre comillas"],
    actions: [{ kind: "mark", mark: "«" }],
    punctuation: true,
  },
  {
    id: "cierraComillas",
    phrases: ["cierra comillas"],
    actions: [{ kind: "mark", mark: "»" }],
    punctuation: true,
  },
  {
    id: "abreParentesis",
    phrases: ["abre paréntesis"],
    actions: [{ kind: "mark", mark: "(" }],
    punctuation: true,
  },
  {
    id: "cierraParentesis",
    phrases: ["cierra paréntesis"],
    actions: [{ kind: "mark", mark: ")" }],
    punctuation: true,
  },
  {
    id: "nuevoParrafo",
    phrases: ["nuevo párrafo"],
    actions: [{ kind: "paragraph" }],
    punctuation: false,
  },
  {
    id: "nuevaLinea",
    phrases: ["nueva línea"],
    actions: [{ kind: "line_break" }],
    punctuation: false,
  },
  {
    id: "nuevoElemento",
    phrases: ["nuevo elemento"],
    actions: [{ kind: "list_item" }],
    punctuation: false,
  },
  { id: "mayuscula", phrases: ["mayúscula"], actions: [{ kind: "cap" }], punctuation: false },
  { id: "literal", phrases: ["literal"], actions: [{ kind: "literal" }], punctuation: false },
  {
    id: "borraEso",
    phrases: ["borra eso"],
    actions: [{ kind: "scratch" }],
    punctuation: false,
  },
];
