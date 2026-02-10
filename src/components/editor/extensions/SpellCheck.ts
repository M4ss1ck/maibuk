import { Extension } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Language } from "../../../features/settings/types";
import { spellCheckService } from "../../../lib/spellcheck";

const WORD_REGEX = /\p{L}+/gu;
const spellCheckPluginKey = new PluginKey("spellCheck");

type Misspelling = {
  from: number;
  to: number;
  word: string;
};

type SpellCheckOptions = {
  language: Language;
  debounceMs: number;
};

type SpellCheckStorage = {
  misspellings: Misspelling[];
};

export const SpellCheck = Extension.create<SpellCheckOptions, SpellCheckStorage>({
  name: "spellCheck",

  addOptions() {
    return {
      language: "en" as Language,
      debounceMs: 300,
    };
  },

  addStorage() {
    return {
      misspellings: [],
    };
  },

  addProseMirrorPlugins() {
    const { debounceMs, language } = this.options;
    const extension = this;

    return [
      new Plugin({
        key: spellCheckPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, value) {
            const meta = transaction.getMeta(spellCheckPluginKey) as
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
        view(editorView) {
          let destroyed = false;
          let debounceTimer: number | null = null;
          let checkVersion = 0;

          spellCheckService.init(language).catch(() => null);

          const updateDecorations = (decorations: Decoration[]) => {
            const decorationSet = DecorationSet.create(editorView.state.doc, decorations);
            const transaction = editorView.state.tr.setMeta(spellCheckPluginKey, {
              decorations: decorationSet,
            });
            editorView.dispatch(transaction);
          };

          const runCheck = async () => {
            const currentVersion = ++checkVersion;
            const { uniqueWords, ranges } = extractWords(editorView.state.doc);

            if (uniqueWords.length === 0) {
              extension.storage.misspellings = [];
              updateDecorations([]);
              return;
            }

            let misspelled: string[] = [];
            try {
              misspelled = await spellCheckService.check(uniqueWords);
            } catch {
              return;
            }

            if (destroyed || currentVersion !== checkVersion) return;

            const misspelledSet = new Set(misspelled);
            const decorations: Decoration[] = [];
            const misspellings: Misspelling[] = [];

            for (const range of ranges) {
              if (!misspelledSet.has(range.word)) continue;
              decorations.push(
                Decoration.inline(range.from, range.to, {
                  class: "spellcheck-error",
                })
              );
              misspellings.push(range);
            }

            extension.storage.misspellings = misspellings;
            updateDecorations(decorations);
          };

          const scheduleCheck = () => {
            if (debounceTimer !== null) {
              window.clearTimeout(debounceTimer);
            }
            debounceTimer = window.setTimeout(() => {
              void runCheck();
            }, debounceMs);
          };

          scheduleCheck();

          return {
            update(view, prevState) {
              if (view.state.doc !== prevState.doc) {
                scheduleCheck();
              }
            },
            destroy() {
              destroyed = true;
              if (debounceTimer !== null) {
                window.clearTimeout(debounceTimer);
              }
            },
          };
        },
      }),
    ];
  },
});

function extractWords(doc: ProseMirrorNode): {
  uniqueWords: string[];
  ranges: Misspelling[];
} {
  const uniqueWords = new Set<string>();
  const ranges: Misspelling[] = [];

  doc.descendants((node, pos, parent) => {
    if (node.type.name === "codeBlock") {
      return false;
    }

    if (!node.isText || !node.text) return;
    if (parent?.type?.name === "codeBlock") return;
    if (node.marks.some((mark) => mark.type.name === "code")) return;

    const text = node.text;
    for (const match of text.matchAll(WORD_REGEX)) {
      if (match.index === undefined) continue;
      const word = match[0];
      if (!word) continue;

      const from = pos + match.index;
      const to = from + word.length;
      ranges.push({ from, to, word });
      uniqueWords.add(word);
    }
  });

  return {
    uniqueWords: Array.from(uniqueWords),
    ranges,
  };
}
