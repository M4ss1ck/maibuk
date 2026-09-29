// The recording script for the Dictation phrase conformance lane (issue #285):
// what a person reads aloud, once, in about two minutes per Dictation Language.
//
// Every default Voice Command phrase is a verb crossed with a target, so the
// script records each verb and each target at least once inside a real
// command, and the scorer infers the rest from those units. Spoken Punctuation
// phrases ride in carrier sentences, several per clip. The gate lane
// (dictation-phrase-set.test.ts) proves the script still covers every unit and
// every entry whenever the defaults change.
import type { DictationLanguage } from "@/features/dictation/types";

export type PhraseItemKind = "voice" | "punctuation" | "prose";

export interface PhraseItem {
  /** Stable clip id; the WAV is `<language>/<id>.wav`. */
  id: string;
  language: DictationLanguage;
  kind: PhraseItemKind;
  /** Exactly what the reader says. */
  say: string;
}

const VOICE: Record<DictationLanguage, readonly string[]> = {
  en: [
    "stop dictation",
    "undo that",
    "redo that",
    "make bold",
    "set boldface",
    "turn on bold",
    "use bold",
    "apply bold",
    "remove bold",
    "turn off bold",
    "make italic",
    "set italics",
    "make underline",
    "make strike",
    "set strikethrough",
    "make code",
    "set inline code",
    "turn into heading one",
    "change to heading one",
    "make heading two",
    "make heading three",
    "start bullet list",
    "begin bulleted list",
    "create bullets",
    "end list",
    "start numbered list",
    "begin number list",
    "create ordered list",
    "make quote",
    "turn into block quote",
    "align left",
    "center left",
    "align center",
    "center text",
    "align right",
    "align justify",
    "center justified",
  ],
  es: [
    "parar dictado",
    "detener dictado",
    "deshacer eso",
    "rehacer eso",
    "poner negrita",
    "activar negritas",
    "usar negrita",
    "aplicar negrita",
    "quitar negrita",
    "desactivar negrita",
    "poner cursiva",
    "activar cursivas",
    "poner subrayado",
    "activar subrayada",
    "poner tachado",
    "activar tachada",
    "poner código",
    "activar código en línea",
    "convertir en título uno",
    "cambiar a título uno",
    "convertir en título dos",
    "convertir en título tres",
    "empezar lista",
    "iniciar lista con viñetas",
    "crear viñetas",
    "terminar lista",
    "salir de lista",
    "empezar lista numerada",
    "iniciar lista ordenada",
    "convertir en cita",
    "cambiar a cita textual",
    "alinear izquierda",
    "centrar izquierda",
    "alinear centro",
    "centrar texto",
    "alinear derecha",
    "alinear justificado",
    "centrar justificada",
  ],
};

const PUNCTUATION: Record<DictationLanguage, readonly string[]> = {
  en: [
    "the rain stopped comma and she left period",
    "are you sure question mark yes exclamation mark wow exclamation point",
    "bring three things colon bread semicolon milk",
    "she said open quote stay close quote",
    "the house open parenthesis the old one close parenthesis burned",
    "the end new paragraph next day new line eggs new item bread",
    "capitalize maibuk is ready",
    "type literal comma",
    "scratch that",
  ],
  es: [
    "llovía coma y ella salió punto y seguido volvió tarde punto",
    "trae tres cosas dos puntos pan punto y coma leche puntos suspensivos",
    "abre interrogación vienes cierra interrogación claro signo de interrogación",
    "abre exclamación qué frío cierra exclamación sí signo de exclamación",
    "dijo abre comillas quédate cierra comillas",
    "la casa abre paréntesis la vieja cierra paréntesis ardió",
    "fin punto y aparte al otro día nuevo párrafo llovió",
    "huevos nueva línea pan nuevo elemento leche",
    "mayúscula maibuk está listo",
    "escribe literal coma",
    "borra eso",
  ],
};

// Sentences that must type as text. The last two English lines are the
// intentional non-matches recorded in #285: the article was the filler.
const PROSE: Record<DictationLanguage, readonly string[]> = {
  en: [
    "I waited for a period of time",
    "Use code.",
    "Center text.",
    "Stop list.",
    "Start the list.",
    "Make it bold.",
    "Turn off the light.",
    "align to the left",
    "turn into a quote",
  ],
  es: [
    "Compré dos puntos y una lista",
    "centrar el texto",
    "empezar la lista",
    "poner la mesa",
    "quitar el polvo",
  ],
};

/** A file-safe id: accents folded, words joined by dashes, at most 48 characters. */
export function clipSlug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
    .replace(/-$/, "");
}

function items(
  language: DictationLanguage,
  kind: PhraseItemKind,
  lines: readonly string[]
): PhraseItem[] {
  const prefix = { voice: "v", punctuation: "p", prose: "x" }[kind];
  return lines.map((say) => ({ id: `${prefix}-${clipSlug(say)}`, language, kind, say }));
}

/** The whole script for one language, in reading order. */
export function phraseItems(language: DictationLanguage): PhraseItem[] {
  return [
    ...items(language, "voice", VOICE[language]),
    ...items(language, "punctuation", PUNCTUATION[language]),
    ...items(language, "prose", PROSE[language]),
  ];
}
