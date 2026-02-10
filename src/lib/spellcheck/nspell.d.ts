declare module "nspell" {
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): this;
    remove(word: string): this;
    personal(words: string): void;
    dictionary(dic: string | Uint8Array): this;
    wordCharacters(): string | null;
    spell(word: string): { correct: boolean; forbidden: boolean; warn: boolean };
  }

  function nspell(aff: string | Uint8Array, dic?: string | Uint8Array): NSpell;
  export default nspell;
}
