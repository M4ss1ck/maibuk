import { Extension } from "@tiptap/core";
import type { Node as ProsemirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { buildSearchRegExp, matchRanges, type SearchOptions } from "@/lib/search/expression";

export type { SearchOptions } from "@/lib/search/expression";
export { buildSearchRegExp } from "@/lib/search/expression";

export interface SearchMatch {
  from: number;
  to: number;
}

/** Scans the document for matches of `term`. Returns [] for empty or invalid input. */
export function findMatches(
  doc: ProsemirrorNode,
  term: string,
  options: SearchOptions
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  if (!term) return matches;

  let regex: RegExp;
  try {
    regex = buildSearchRegExp(term, options);
  } catch {
    return matches;
  }

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const range of matchRanges(regex, node.text)) {
      const from = pos + range.start;
      matches.push({ from, to: pos + range.end });
    }
  });

  return matches;
}

export const searchReplacePluginKey = new PluginKey<DecorationSet>("searchReplace");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    searchReplace: {
      setSearchHighlights: (payload: { matches: SearchMatch[]; activeIndex: number }) => ReturnType;
      clearSearchHighlights: () => ReturnType;
    };
  }
}

export const SearchReplace = Extension.create({
  name: "searchReplace",

  addCommands() {
    return {
      setSearchHighlights:
        ({ matches, activeIndex }) =>
        ({ tr, state, dispatch }) => {
          if (dispatch) {
            const decorations = matches.map((match, index) =>
              Decoration.inline(match.from, match.to, {
                class:
                  index === activeIndex ? "search-result search-result-active" : "search-result",
              })
            );
            const set = DecorationSet.create(state.doc, decorations);
            dispatch(tr.setMeta(searchReplacePluginKey, { decorations: set }));
          }
          return true;
        },
      clearSearchHighlights:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            dispatch(
              tr.setMeta(searchReplacePluginKey, {
                decorations: DecorationSet.empty,
              })
            );
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: searchReplacePluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, value) {
            const meta = transaction.getMeta(searchReplacePluginKey) as
              | { decorations?: DecorationSet }
              | undefined;

            if (meta?.decorations) {
              return meta.decorations;
            }

            if (transaction.docChanged) {
              return value.map(transaction.mapping, transaction.doc);
            }

            return value;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});
