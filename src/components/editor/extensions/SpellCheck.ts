import { Extension } from "@tiptap/core";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Language } from "../../../features/settings/types";
import { useSettingsStore } from "../../../features/settings/store";
import { spellCheckService } from "../../../lib/spellcheck";

const WORD_REGEX = /\p{L}+(?:['\u2019]\p{L}+)*/gu;
const FILE_LIKE_REGEX =
  /\b[\p{L}\p{N}][\p{L}\p{N}_-]*\.(?:[\p{L}\p{N}]{2,5})(?:\.[\p{L}\p{N}]{2,5})*\b/gu;
const URL_LIKE_REGEX = /(?:https?:\/\/|www\.)\S+/gi;
const EMAIL_LIKE_REGEX = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const spellCheckPluginKey = new PluginKey("spellCheck");

type Misspelling = {
  from: number;
  to: number;
  word: string;
};

type SpellCheckOptions = {
  language: Language;
  enabled: boolean;
  debounceMs: number;
};

type SpellCheckStorage = {
  misspellings: Misspelling[];
  enabled: boolean;
  language: Language;
  requestCheck: (() => void) | null;
  clearDecorations: (() => void) | null;
  getMisspellingAt: ((pos: number) => Misspelling | null) | null;
};

async function initSpellCheckWithCustomDictionary(
  language: Language,
  options: { force?: boolean } = {}
): Promise<void> {
  await spellCheckService.init(language, options);
  const customDictionary = useSettingsStore.getState().customDictionary;
  if (customDictionary.length > 0) {
    await spellCheckService.loadCustomDictionary(customDictionary);
  }
}

declare module "@tiptap/core" {
  interface Storage {
    spellCheck?: SpellCheckStorage;
  }
  interface Commands<ReturnType> {
    spellCheck: {
      toggleSpellCheck: () => ReturnType;
      setSpellCheckEnabled: (enabled: boolean) => ReturnType;
      setSpellCheckLanguage: (language: Language) => ReturnType;
      addToDictionary: (word: string) => ReturnType;
    };
  }
}

export const SpellCheck = Extension.create<SpellCheckOptions, SpellCheckStorage>({
  name: "spellCheck",

  addOptions() {
    return {
      language: "en" as Language,
      enabled: true,
      debounceMs: 300,
    };
  },

  addStorage() {
    return {
      misspellings: [],
      enabled: this.options.enabled,
      language: this.options.language,
      requestCheck: null,
      clearDecorations: null,
      getMisspellingAt: null,
    };
  },

  addCommands() {
    return {
      toggleSpellCheck:
        () =>
        ({ editor }) => {
          const storage = editor.storage.spellCheck;
          if (!storage) return false;

          const nextEnabled = !storage.enabled;
          return editor.commands.setSpellCheckEnabled(nextEnabled);
        },
      setSpellCheckEnabled:
        (enabled: boolean) =>
        ({ editor }) => {
          const storage = editor.storage.spellCheck;
          if (!storage) return false;
          if (storage.enabled === enabled) return true;

          storage.enabled = enabled;

          if (!enabled) {
            storage.clearDecorations?.();
            return true;
          }

          void initSpellCheckWithCustomDictionary(storage.language).finally(() => {
            storage.requestCheck?.();
          });
          return true;
        },
      setSpellCheckLanguage:
        (language: Language) =>
        ({ editor }) => {
          const storage = editor.storage.spellCheck;
          if (!storage || storage.language === language) return true;

          storage.language = language;

          if (storage.enabled) {
            void initSpellCheckWithCustomDictionary(language).finally(() => {
              storage.requestCheck?.();
            });
          }

          return true;
        },
      addToDictionary:
        (word: string) =>
        ({ editor }) => {
          const storage = editor.storage.spellCheck;
          if (!storage) return false;

          const normalized = word.trim();
          if (!normalized) return false;

          useSettingsStore.getState().addCustomWord(normalized);
          spellCheckService.addWord(normalized);

          if (storage.enabled) {
            storage.requestCheck?.();
          }

          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { debounceMs } = this.options;
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
          let unsubscribe: (() => void) | null = null;
          let lastDictionary = normalizeDictionary(useSettingsStore.getState().customDictionary);

          if (extension.storage.enabled) {
            void initSpellCheckWithCustomDictionary(extension.storage.language);
          }

          const updateDecorations = (decorations: Decoration[]) => {
            const decorationSet = DecorationSet.create(editorView.state.doc, decorations);
            const transaction = editorView.state.tr.setMeta(spellCheckPluginKey, {
              decorations: decorationSet,
            });
            editorView.dispatch(transaction);
          };

          const runCheck = async () => {
            const currentVersion = ++checkVersion;

            if (!extension.storage.enabled) {
              extension.storage.misspellings = [];
              updateDecorations([]);
              return;
            }

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

            if (destroyed || currentVersion !== checkVersion || !extension.storage.enabled) return;

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
            if (!extension.storage.enabled) {
              extension.storage.misspellings = [];
              updateDecorations([]);
              return;
            }
            if (debounceTimer !== null) {
              window.clearTimeout(debounceTimer);
            }
            debounceTimer = window.setTimeout(() => {
              void runCheck();
            }, debounceMs);
          };

          scheduleCheck();

          unsubscribe = useSettingsStore.subscribe((state) => {
            const nextDictionary = normalizeDictionary(state.customDictionary);
            if (areArraysEqual(nextDictionary, lastDictionary)) return;

            const previousSet = new Set(lastDictionary);
            const nextSet = new Set(nextDictionary);
            const removed = lastDictionary.some((word) => !nextSet.has(word));
            const added = nextDictionary.filter((word) => !previousSet.has(word));

            lastDictionary = nextDictionary;

            if (!extension.storage.enabled) return;

            if (removed) {
              void initSpellCheckWithCustomDictionary(extension.storage.language, {
                force: true,
              }).finally(() => {
                extension.storage.requestCheck?.();
              });
              return;
            }

            if (added.length > 0) {
              for (const word of added) {
                spellCheckService.addWord(word);
              }
              extension.storage.requestCheck?.();
            }
          });

          extension.storage.requestCheck = scheduleCheck;
          extension.storage.clearDecorations = () => {
            extension.storage.misspellings = [];
            updateDecorations([]);
          };
          extension.storage.getMisspellingAt = (pos: number) => {
            for (const misspelling of extension.storage.misspellings) {
              if (pos >= misspelling.from && pos <= misspelling.to) {
                return misspelling;
              }
            }
            return null;
          };

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
              unsubscribe?.();
              unsubscribe = null;
              extension.storage.requestCheck = null;
              extension.storage.clearDecorations = null;
              extension.storage.getMisspellingAt = null;
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

  doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") {
      return false;
    }

    if (!node.isText || !node.text) return;
    if (node.marks.some((mark) => mark.type.name === "code")) return;
    if (node.marks.some((mark) => mark.type.name === "link")) return;

    const text = node.text;
    const excludedRanges = collectExcludedRanges(text);
    for (const match of text.matchAll(WORD_REGEX)) {
      if (match.index === undefined) continue;
      const word = match[0];
      if (!word) continue;
      if (isWithinExcludedRange(match.index, word.length, excludedRanges)) continue;

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

function collectExcludedRanges(text: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (const match of text.matchAll(URL_LIKE_REGEX)) {
    if (match.index === undefined) continue;
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }
  for (const match of text.matchAll(EMAIL_LIKE_REGEX)) {
    if (match.index === undefined) continue;
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }
  for (const match of text.matchAll(FILE_LIKE_REGEX)) {
    if (match.index === undefined) continue;
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }
  return ranges;
}

function isWithinExcludedRange(
  start: number,
  length: number,
  ranges: { from: number; to: number }[]
): boolean {
  if (ranges.length === 0) return false;
  const end = start + length;
  return ranges.some((range) => start < range.to && end > range.from);
}

function normalizeDictionary(words: string[]): string[] {
  return words.map((word) => word.trim().toLowerCase()).filter((word) => word.length > 0);
}

function areArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}
