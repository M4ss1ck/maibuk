import { Extension, type Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { createSymbolSuggestionRenderer } from "@/components/editor/SymbolSuggestion";
import { loadEmojiSymbols } from "@/features/symbols/load";
import { searchSymbols } from "@/features/symbols/search";
import type { SymbolEntry } from "@/features/symbols/types";
import i18n from "@/i18n";

export const SYMBOL_AUTOCOMPLETE_LIMIT = 10;

type SymbolItems = (props: {
  query: string;
  editor: Editor;
}) => SymbolEntry[] | Promise<SymbolEntry[]>;

interface SymbolAutocompleteOptions {
  items: SymbolItems;
  render: SuggestionOptions<SymbolEntry, SymbolEntry>["render"];
}

const symbolAutocompletePluginKey = new PluginKey("symbolAutocomplete");

export const SymbolAutocomplete = Extension.create<SymbolAutocompleteOptions>({
  name: "symbolAutocomplete",
  priority: 1000,

  addOptions() {
    return {
      items: async ({ query }) => {
        const entries = await loadEmojiSymbols(i18n.language);
        return searchSymbols(entries, query, null, SYMBOL_AUTOCOMPLETE_LIMIT);
      },
      render: createSymbolSuggestionRenderer(),
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SymbolEntry, SymbolEntry>({
        editor: this.editor,
        pluginKey: symbolAutocompletePluginKey,
        char: ":",
        allowedPrefixes: [" "],
        shouldShow: ({ query }) => query.length > 0,
        items: async (props) =>
          (await this.options.items(props)).slice(0, SYMBOL_AUTOCOMPLETE_LIMIT),
        render: this.options.render,
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).insertContent(props.glyph).run();
        },
      }),
    ];
  },
});
