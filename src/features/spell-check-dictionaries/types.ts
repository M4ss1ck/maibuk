import type { PinnedFile } from "@/lib/verified-download";

export type DictionaryScript = "Latin" | "Cyrillic" | "Greek";

/** One language's Hunspell pair and its provenance. */
export interface SpellCheckDictionary {
  language: string;
  script: DictionaryScript;
  aff: PinnedFile;
  dic: PinnedFile;
  license: string;
  source: string;
}
