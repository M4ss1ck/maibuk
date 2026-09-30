// Context passages for the context biasing spike (issue #274): what an open
// Chapter and a whole Book would hand to `setContext`. Pure over a source text,
// so the gate lane tests them without a model or a download.
import type { DictationLanguage } from "@/features/dictation/types";

/** Sentences that carry a name the way a Book does, never the recorded lines. */
const CARRIERS: Record<DictationLanguage, readonly string[]> = {
  en: [
    "Nobody in the house had forgotten {name}.",
    "The letter spoke of {name} twice before it ended.",
    "Later that night the talk came back to {name}.",
  ],
  es: [
    "Nadie en la casa había olvidado {name}.",
    "La carta nombraba {name} dos veces antes de terminar.",
    "Esa noche la conversación volvió a {name}.",
  ],
};

/** The novel between Project Gutenberg's start and end markers. */
export function gutenbergBody(text: string): string {
  const start = text.search(/^\*\*\* START OF .*\*\*\*$/m);
  const end = text.search(/^\*\*\* END OF .*\*\*\*$/m);
  if (start === -1 || end === -1) throw new Error("no Project Gutenberg markers");
  return text.slice(text.indexOf("\n", start) + 1, end).trim();
}

/**
 * The first `words` words of `body`, with each name carried `perName` times,
 * spread evenly by words: every carrier sentence goes in at the first
 * paragraph break after its share of the text.
 */
export function bookPassage(
  body: string,
  words: number,
  names: readonly string[],
  language: DictationLanguage,
  perName = 3
): string {
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim());
  const kept: string[] = [];
  let count = 0;
  for (const paragraph of paragraphs) {
    if (!paragraph) continue;
    const own = paragraph.split(" ");
    const room = words - count;
    if (room <= 0) break;
    kept.push(own.slice(0, room).join(" "));
    count += Math.min(own.length, room);
  }
  const carriers = CARRIERS[language];
  const sentences: string[] = [];
  for (let round = 0; round < perName; round += 1) {
    for (const name of names) {
      sentences.push(carriers[round % carriers.length].replace("{name}", name));
    }
  }
  const out: string[] = [];
  let next = 0;
  let seen = 0;
  for (const paragraph of kept) {
    out.push(paragraph);
    seen += paragraph.split(" ").length;
    const due = Math.floor((seen * sentences.length) / count);
    if (due > next) {
      out.push(sentences.slice(next, due).join(" "));
      next = due;
    }
  }
  return out.join("\n\n");
}

/**
 * How many times to repeat the Vocabulary written forms so they outrank the
 * passage's own terms: one more than the most any long word (5 letters or
 * more, the words a tokenizer spells in pieces) occurs. `setContext` keeps
 * the terms the passage leans on hardest when it has to cap the list.
 */
export function formsRepeat(passage: string): number {
  const counts = new Map<string, number>();
  for (const word of passage.match(/\p{L}{5,}/gu) ?? []) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values()) + 1;
}

/** The written forms as a passage of their own, repeated `times`. */
export function formsPassage(forms: readonly string[], times = 1): string {
  const line = `${forms.join(". ")}.`;
  return Array.from({ length: times }, () => line).join("\n");
}
