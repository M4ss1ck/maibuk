import { common, createLowlight, type LanguageFn } from "lowlight";

type Language = ReturnType<LanguageFn>;
type Mode = Exclude<NonNullable<Language["contains"]>[number], "self">;

// Letters and digits an underscore may not touch to open or close emphasis:
// ASCII plus Latin-1 and Latin Extended, so Spanish words count as words.
// highlight.js drops per-regex flags, which rules out `\p{L}`. Openers also
// refuse a preceding `_`: CommonMark reads a run like `__` as one delimiter,
// and a preceding backslash, which escapes the underscore (`\_word_`).
const WORD = "A-Za-z0-9\\u00C0-\\u024F";

/** CommonMark rules for the underscore variants, keyed by the upstream source. */
const UNDERSCORE_RULES: Record<string, { begin: RegExp; end: RegExp }> = {
  // Italic `_`: the opener needs a valid closer later on the same line, or
  // `_x_y z` would paint the rest of the block.
  "_(?![_\\s])": {
    begin: new RegExp(`(?<![${WORD}_\\\\])_(?![_\\s])(?=[^\\n]*?[^\\s_]_(?![${WORD}]))`),
    end: new RegExp(`_(?![${WORD}])`),
  },
  // Bold `__`.
  "_{2}(?!\\s)": {
    begin: new RegExp(`(?<![${WORD}_\\\\])_{2}(?!\\s)`),
    end: new RegExp(`_{2}(?![${WORD}])`),
  },
};

/**
 * highlight.js's Markdown grammar opens emphasis on any `_`, so `snake_case`
 * paints everything after the underscore as italic. CommonMark never lets an
 * intraword underscore open or close emphasis; this swaps the two underscore
 * variants for ones that follow that rule. The `*` variants are already right,
 * since CommonMark allows `*` intraword.
 */
export function withCommonMarkUnderscores(grammar: LanguageFn): LanguageFn {
  return (hljs) => {
    const language = grammar(hljs);
    const seen = new Set<Mode>();
    const visit = (mode: Mode | "self" | undefined) => {
      if (!mode || mode === "self" || seen.has(mode)) return;
      seen.add(mode);
      const rule = mode.begin instanceof RegExp ? UNDERSCORE_RULES[mode.begin.source] : undefined;
      if (rule) {
        mode.begin = rule.begin;
        mode.end = rule.end;
      }
      for (const child of [...(mode.contains ?? []), ...(mode.variants ?? [])]) visit(child);
      visit(mode.starts);
    };
    for (const mode of language.contains ?? []) visit(mode);
    return language;
  };
}

/**
 * Shared lowlight (highlight.js) registry. `common` covers the ~35 most
 * popular languages — including their aliases, so the ```sh fenced shortcut
 * resolves to the shell grammar.
 */
const baseLowlight = createLowlight({
  ...common,
  markdown: withCommonMarkUnderscores(common.markdown),
});

export const lowlight: typeof baseLowlight = {
  ...baseLowlight,
  highlightAuto(value) {
    return { type: "root", children: [{ type: "text", value }] };
  },
};
