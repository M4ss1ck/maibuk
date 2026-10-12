// PostCSS ships types for its public API but not for the tokenizer, which the
// css-scope pre-check uses to reject strings the browser would end at a raw
// newline (a CSS Syntax Level 3 bad-string) before PostCSS parses them.

declare module "postcss/lib/tokenize" {
  import type Input from "postcss/lib/input";

  export type TokenType =
    | "word"
    | "string"
    | "comment"
    | "at-word"
    | "brackets"
    | "space"
    | "end"
    | "("
    | ")"
    | "["
    | "]"
    | "{"
    | "}"
    | ";"
    | ":"
    | ",";

  /** `[type, content, start, end, unclosed?]`, the shape PostCSS's parser reads. */
  export type Token = [TokenType, string, number?, number?, string?];

  export interface Tokenizer {
    back(token: Token): void;
    endOfFile(): boolean;
    nextToken(options?: { ignoreUnclosed?: boolean }): Token | undefined;
    position(): number;
  }

  export default function tokenize(input: Input, options?: { ignoreErrors?: boolean }): Tokenizer;
}
