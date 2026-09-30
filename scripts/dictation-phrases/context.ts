// Writes the context passages for the context biasing spike (issue #274).
//   pnpm exec tsx scripts/dictation-phrases/context.ts
//
// Reads the Project Gutenberg novels in vendor/moonshine/context/source/
// (en.txt: A Tale of Two Cities, pg98; es.txt: Don Quijote, pg2000) and writes,
// per language, into vendor/moonshine/context/<lang>/:
//   keyterms.txt       the Vocabulary written forms, comma-separated (setKeyterms)
//   forms.txt          the written forms as a passage (setContext, option a)
//   chapter.txt        5,000 words carrying each name three times
//   book.txt           100,000 words carrying each name three times
//   chapter-forms.txt  chapter.txt after the written forms, repeated to outrank it
//   book-forms.txt     book.txt the same way (option b)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DictationLanguage } from "@/features/dictation/types";
import { phraseItems } from "@/test/support/dictation-phrase-set";
import { bookPassage, formsPassage, formsRepeat, gutenbergBody } from "./passages";

const here = dirname(fileURLToPath(import.meta.url));
const contextDir = resolve(here, "../../vendor/moonshine/context");

export const CHAPTER_WORDS = 5_000;
export const BOOK_WORDS = 100_000;

for (const language of ["en", "es"] as DictationLanguage[]) {
  const forms = phraseItems(language)
    .filter((item) => item.kind === "alone")
    .map((item) => item.say);
  const body = gutenbergBody(readFileSync(join(contextDir, "source", `${language}.txt`), "utf8"));
  const out = join(contextDir, language);
  mkdirSync(out, { recursive: true });
  const write = (name: string, text: string) => {
    writeFileSync(join(out, name), `${text}\n`);
    console.log(`${language}/${name.padEnd(18)} ${text.split(/\s+/).length} words`);
  };
  write("keyterms.txt", forms.join(","));
  write("forms.txt", formsPassage(forms));
  for (const [name, words] of [
    ["chapter", CHAPTER_WORDS],
    ["book", BOOK_WORDS],
  ] as const) {
    const passage = bookPassage(body, words, forms, language);
    const times = formsRepeat(passage);
    write(`${name}.txt`, passage);
    write(`${name}-forms.txt`, `${formsPassage(forms, times)}\n\n${passage}`);
    console.log(`  forms repeated ${times} times`);
  }
}
