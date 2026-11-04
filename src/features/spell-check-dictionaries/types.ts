/** One installed file: where it came from, how big it is, and its pin. */
export interface DictionaryFile {
  url: string;
  bytes: number;
  sha256: string;
}

export type DictionaryScript = "Latin" | "Cyrillic" | "Greek";

/** One language's Hunspell pair and its provenance. */
export interface SpellCheckDictionary {
  language: string;
  script: DictionaryScript;
  aff: DictionaryFile;
  dic: DictionaryFile;
  license: string;
  source: string;
}

/** Where an installed dictionary lives; each platform verifies what it reads. */
export interface SpellCheckDictionaryFiles {
  read(language: string, name: string): Promise<Uint8Array | null>;
  write(language: string, name: string, data: Uint8Array): Promise<void>;
  remove(language: string): Promise<void>;
}
