// The recording script for the Dictation phrase conformance lane (issue #285):
// what a person reads aloud, once, in about two minutes per Dictation Language.
//
// Every default Voice Command phrase is a verb crossed with a target, so the
// script records each verb and each target at least once inside a real
// command, and the scorer infers the rest from those units. Demonstrative
// mark phrases ("bold that") are recorded as whole clips, never inferred.
// App-tier whole-line phrases ("go to notes", "click export") are recorded
// as whole clips and scored as whole clips, never inferred.
// Spoken Punctuation phrases ride in carrier sentences, several per clip.
// The names tier (issue #274) is ordinary prose carrying unusual names and
// jargon, recorded last so a rerun of the recorder adds only it. The
// gate lane (dictation-phrase-set.test.ts) proves the script still covers
// every unit and every entry whenever the defaults change.
import type { DictationLanguage } from "@/features/dictation/types";

export type PhraseItemKind = "voice" | "app" | "punctuation" | "prose" | "names";

export interface PhraseItem {
  /** Stable clip id; the WAV is `<language>/<id>.wav`. */
  id: string;
  language: DictationLanguage;
  kind: PhraseItemKind;
  /** Exactly what the reader says. */
  say: string;
  /** Names tier only: the written forms scored in this line, in order. */
  names?: readonly string[];
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
    "make bold that",
    "remove italics that",
    "bold that",
    "underline that",
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
    "poner negrita eso",
    "quitar cursiva esto",
    "negrita eso",
    "subrayado esto",
  ],
};

// App-tier whole-line phrases (issue #324): one clip per phrase, recorded
// whole and scored whole, never inferred from units. Each line runs a
// whole-line Voice Command or a Click by Name on its own text.
const APP: Record<DictationLanguage, readonly string[]> = {
  en: [
    "go to notes",
    "sync now",
    "show voice commands",
    "dark theme",
    "press tab",
    "press shift tab",
    "press down",
    "press enter",
    "press escape",
    "click export",
    "click cancel",
    "click two",
    "click three",
  ],
  es: [
    "ir a notas",
    "sincronizar ahora",
    "mostrar comandos de voz",
    "tema oscuro",
    "pulsar tab",
    "pulsar mayús tab",
    "pulsar abajo",
    "pulsar intro",
    "pulsar escape",
    "pulsar exportar",
    "pulsar cancelar",
    "pulsar dos",
    "pulsar tres",
  ],
};

// Carriers use only common words: a word no model knows (the first script
// said "Maibuk") makes the model end the line before it, and a "capitalize"
// with no word after it on its line stays as prose, so that clip could only fail.
const PUNCTUATION: Record<DictationLanguage, readonly string[]> = {
  en: [
    "the rain stopped comma and she left period",
    "are you sure question mark yes exclamation mark wow exclamation point",
    "bring three things colon bread semicolon milk",
    "she said open quote stay close quote",
    "the house open parenthesis the old one close parenthesis burned",
    "the end new paragraph next day new line eggs new item bread",
    "capitalize summer is here",
    "all caps on the end all caps off",
    "chapter numeral twenty one begins",
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
    "mayúscula verano ya llegó",
    "mayúsculas activadas fin mayúsculas desactivadas",
    "capítulo numeral veintiuno empieza",
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
    "I said that.",
    "Make that bold.",
    "That is bold.",
  ],
  es: [
    "Compré dos puntos y una lista",
    "centrar el texto",
    "empezar la lista",
    "poner la mesa",
    "quitar el polvo",
    "Eso es negrita.",
    "Pon eso en negrita.",
    "Dije eso.",
  ],
};

// Unusual names and jargon in ordinary prose (issue #274): the recordings the
// context biasing spike measures, scoring only the words in braces, as exact
// written forms. Invented names stand for an author's characters and places.
// No line starts with a name, so sentence casing never decides a hit, and no
// line says a Voice Command or a Spoken Punctuation phrase.
const NAMES: Record<DictationLanguage, readonly string[]> = {
  en: [
    "yesterday we drove with {Siobhan} to {Llangollen} for the weekend",
    "the old sailor named his boat the {Ximena} after his mother",
    "our guide {Tadhg} says the {Brahmaputra} floods every spring",
    "she restarted {Kubernetes} and flushed the {Redis} cache before lunch",
    "in the story the dragon {Zorvath} guards the gates of {Ithilmere}",
    "my editor {Oyelaran} wants more {sfumato} in the second act",
    "they drank cold {kvass} at the market in {Tbilisi}",
    "every winter {Wojciechowska} bakes {pierogi} for the whole street",
    "the knight {Aelfric} rode north toward {Dunmarrow} at dawn",
    "her thesis on {epigenetics} impressed professor {Nguyen} at once",
  ],
  es: [
    "ayer {Xóchitl} viajó a {Oaxaca} con su hermano",
    "el pescador llamó a su barca {Itziar} por su madre",
    "nuestro guía {Iñaki} dice que el {Urubamba} crece en verano",
    "reinició {Kubernetes} y vació la caché de {Redis} antes del almuerzo",
    "en la novela el dragón {Zorvath} vigila las puertas de {Ithilmere}",
    "mi editora {Maialen} quiere más {sfumato} en el segundo acto",
    "tomamos {tepache} frío en el mercado de {Tlaquepaque}",
    "cada invierno {Wojciechowska} hornea {pierogi} para toda la calle",
    "el caballero {Aelfric} cabalgó hacia {Dunmarrow} al amanecer",
    "su tesis sobre {epigenética} convenció enseguida a la doctora {Etxeberria}",
  ],
};

/** A names line without its braces, and the braced names in order. */
export function parseNamesLine(line: string): { say: string; names: string[] } {
  const names: string[] = [];
  const say = line.replace(/\{([^{}]+)\}/g, (_, name: string) => {
    names.push(name);
    return name;
  });
  if (/[{}]/.test(say)) throw new Error(`unbalanced brace in names line "${line}"`);
  if (names.length === 0) throw new Error(`names line "${line}" has no {name}`);
  return { say, names };
}

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
  const prefix = { voice: "v", app: "a", punctuation: "p", prose: "x", names: "n" }[kind];
  return lines.map((line) => {
    if (kind !== "names") return { id: `${prefix}-${clipSlug(line)}`, language, kind, say: line };
    const { say, names } = parseNamesLine(line);
    return { id: `${prefix}-${clipSlug(say)}`, language, kind, say, names };
  });
}

/** The whole script for one language, in reading order. */
export function phraseItems(language: DictationLanguage): PhraseItem[] {
  return [
    ...items(language, "voice", VOICE[language]),
    ...items(language, "app", APP[language]),
    ...items(language, "punctuation", PUNCTUATION[language]),
    ...items(language, "prose", PROSE[language]),
    ...items(language, "names", NAMES[language]),
  ];
}
