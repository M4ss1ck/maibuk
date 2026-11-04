import { Extension, InputRule, textInputRule } from "@tiptap/core";
import { baseLanguage } from "@/lib/writing-language";

const OPEN_FIND = /(?:^|[\s{[(<'"\u2018\u201C])(")$/;
const CLOSE_FIND = /"$/;

/** The double quotes the language puts around a quotation. */
export function quotesFor(language: string): { open: string; close: string } {
  switch (baseLanguage(language)) {
    case "fr":
      // « NBSP ... NBSP »
      return { open: "\u00AB\u00A0", close: "\u00A0\u00BB" };
    case "de":
      return { open: "\u201E", close: "\u201C" };
    default:
      return { open: "\u201C", close: "\u201D" };
  }
}

/** Curls a typed straight double quote into the writing language's quotes. */
export const WritingQuotes = Extension.create<{
  /** The writing language, read per keystroke. */
  getLanguage: () => string;
}>({
  name: "writingQuotes",

  addOptions() {
    return { getLanguage: () => "en" };
  },

  addInputRules() {
    const { getLanguage } = this.options;

    return [
      new InputRule({
        find: OPEN_FIND,
        handler: (props) =>
          textInputRule({ find: OPEN_FIND, replace: quotesFor(getLanguage()).open }).handler(props),
      }),
      new InputRule({
        find: CLOSE_FIND,
        handler: (props) =>
          textInputRule({ find: CLOSE_FIND, replace: quotesFor(getLanguage()).close }).handler(
            props
          ),
      }),
    ];
  },
});
