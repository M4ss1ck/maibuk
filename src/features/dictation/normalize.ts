// The one phrase normalizer (ADR 0015): matching, storage, and conflict checks
// all fold case and accents and drop the model's own punctuation the same way.

const TOKEN_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu;

export interface Token {
  surface: string;
  norm: string | null;
  mark: boolean;
  /**
   * A Dictation Vocabulary written form: literal text that no later step may
   * match, re-case, or otherwise reinterpret (ADR 0015).
   */
  protected?: boolean;
}

export function normalizeWord(word: string): string {
  return word
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.normalize("NFC").matchAll(TOKEN_RE)) {
    const surface = match[0];
    if (/[\p{L}\p{N}]/u.test(surface)) {
      tokens.push({ surface, norm: normalizeWord(surface), mark: false });
    } else {
      tokens.push({ surface, norm: null, mark: true });
    }
  }
  return tokens;
}

/** Case- and accent-folded, punctuation-free phrase key. Shared by matching and storage. */
export function normalizePhrase(text: string): string {
  return tokenize(text)
    .filter((token) => !token.mark)
    .map((token) => token.norm ?? "")
    .join(" ");
}
