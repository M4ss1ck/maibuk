import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { FindReplace } from "@/components/editor/FindReplace";
import { ImageInsertDialog } from "@/components/editor/ImageInsertDialog";
import { FootnoteDialog } from "@/components/editor/FootnoteDialog";
import {
  LinkDialog,
  type InternalTarget,
  type InternalTargetChildrenLoader,
} from "@/components/editor/LinkDialog";
import { DictionaryDialog } from "@/components/editor/DictionaryDialog";
import { DictionaryPromptDialog } from "@/components/editor/DictionaryPromptDialog";
import { SymbolsDialog } from "@/components/editor/SymbolsDialog";
import { useIsActiveEditor } from "@/components/editor/editor-command-source";
import { useSettingsStore } from "@/features/settings/store";
import { dictionaryStatus, useSpellCheckDictionaries } from "@/features/spell-check-dictionaries";
import { useSearchSwitchesStore } from "@/features/search/switches";
import type { SearchHandoff } from "@/features/search/types";
import { wiktionaryPageUrl } from "@/lib/dictionary";
import { isModKey } from "@/lib/keyboard";
import { openExternal } from "@/lib/platform";
import { useShortcuts } from "@/lib/shortcuts";
import type { WritingLanguage } from "@/lib/writing-language";

export interface EditorSurfaceOptions {
  bookId?: string | null;
  spellCheckLanguage: WritingLanguage;
  internalTargets?: InternalTarget[];
  loadInternalTargetChildren?: InternalTargetChildrenLoader;
  findHandoff?: SearchHandoff | null;
  onHandoffApplied?: () => void;
  /** Where the Find and Replace bar is portaled; rendered in place when absent. */
  findContainer?: HTMLElement | null;
}

export function useEditorSurface(
  editor: Editor | null,
  {
    bookId,
    spellCheckLanguage,
    internalTargets,
    loadInternalTargetChildren,
    findHandoff = null,
    onHandoffApplied,
    findContainer,
  }: EditorSurfaceOptions
): {
  openFindReplace: () => void;
  closeFindReplace: () => void;
  isFindReplaceOpen: boolean;
  openLinkDialog: () => void;
  openImageDialog: () => void;
  openFootnote: () => void;
  openSymbols: () => void;
  openDictionary: () => void;
  lookupWord: (word: string, language?: WritingLanguage) => void;
  /** True while the Find bar or any of the dialogs below is open. */
  isOverlayOpen: boolean;
  /** Find bar + Image, Footnote, Link, Dictionary, DictionaryPrompt, Symbols dialogs. */
  surface: ReactNode;
} {
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findReplaceFocusSignal, setFindReplaceFocusSignal] = useState(0);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [showFootnoteDialog, setShowFootnoteDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showDictionaryDialog, setShowDictionaryDialog] = useState(false);
  const [showDictionaryPrompt, setShowDictionaryPrompt] = useState(false);
  const [dictionaryWord, setDictionaryWord] = useState("");
  const [showSymbolsDialog, setShowSymbolsDialog] = useState(false);
  const dictionaryOpenInBrowser = useSettingsStore((state) => state.dictionaryOpenInBrowser);
  const setDictionaryOpenInBrowser = useSettingsStore((state) => state.setDictionaryOpenInBrowser);
  const spellCheckEnabled = useSettingsStore((state) => state.spellCheckEnabled);
  const setSpellCheckEnabled = useSettingsStore((state) => state.setSpellCheckEnabled);

  const openFindReplace = useCallback(() => {
    setShowFindReplace(true);
    setFindReplaceFocusSignal((current) => current + 1);
  }, []);

  // A Library Search text row opened this editor: open Find and Replace with
  // its query. The switches arrive through the shared store, applied by the
  // destination before this mounted. One-shot per handoff object, so a
  // Back/Forward entry (which carries no handoff) never reopens it.
  const appliedFindHandoffRef = useRef<SearchHandoff | null>(null);
  useEffect(() => {
    if (!findHandoff || appliedFindHandoffRef.current === findHandoff) return;
    appliedFindHandoffRef.current = findHandoff;
    openFindReplace();
    onHandoffApplied?.();
  }, [findHandoff, onHandoffApplied, openFindReplace]);

  const handleLookupWord = useCallback(
    (word: string, language: WritingLanguage = spellCheckLanguage) => {
      if (dictionaryOpenInBrowser) {
        openExternal(wiktionaryPageUrl(word, language));
        return;
      }
      setDictionaryWord(word);
      setShowDictionaryDialog(true);
    },
    [dictionaryOpenInBrowser, spellCheckLanguage]
  );

  const handleOpenDictionary = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ").trim();
    if (!selectedText) {
      setShowDictionaryPrompt(true);
      return;
    }
    const word = selectedText.split(/\s+/)[0];
    if (!word) return;
    handleLookupWord(word);
  }, [editor, handleLookupWord]);

  useEffect(() => {
    if (!editor?.view?.dom) return;
    const dom = editor.view.dom;

    const handleEditorKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || !isModKey(event)) {
        return;
      }

      if (event.altKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setShowFootnoteDialog(true);
      }
    };

    dom.addEventListener("keydown", handleEditorKeyDown);
    return () => {
      dom.removeEventListener("keydown", handleEditorKeyDown);
    };
  }, [editor]);

  const isActiveEditor = useIsActiveEditor(editor);

  useShortcuts(
    [
      {
        id: "common.find",
        allowInInput: true,
        onTrigger: openFindReplace,
      },
      // The shared search switches, without the panel's inputs: typing in the
      // Chapter or Note text keeps the platform keys (Option+C still types ç),
      // while the open Find and Replace panel takes them in its own inputs.
      {
        id: "common.matchCase",
        onTrigger: () => useSearchSwitchesStore.getState().toggleMatchCase(),
      },
      {
        id: "common.wholeWord",
        onTrigger: () => useSearchSwitchesStore.getState().toggleWholeWord(),
      },
      {
        id: "common.useRegex",
        onTrigger: () => useSearchSwitchesStore.getState().toggleRegex(),
      },
      {
        id: "editor.dictionary",
        allowInInput: true,
        onTrigger: handleOpenDictionary,
      },
      {
        id: "editor.insertSymbol",
        allowInInput: true,
        onTrigger: () => setShowSymbolsDialog(true),
      },
      {
        id: "editor.insertLink",
        allowInInput: true,
        onTrigger: () => setShowLinkDialog(true),
      },
      {
        id: "editor.insertImage",
        allowInInput: true,
        onTrigger: () => setShowImageDialog(true),
      },
      {
        id: "editor.footnote",
        allowInInput: true,
        onTrigger: () => setShowFootnoteDialog(true),
      },
      {
        id: "editor.horizontalRule",
        allowInInput: true,
        onTrigger: () => {
          if (!editor) return;
          editor.chain().focus().setHorizontalRule().run();
        },
      },
      {
        id: "editor.increaseFirstLineIndent",
        allowInInput: true,
        onTrigger: () => {
          if (!editor) return;
          editor.chain().focus().increaseFirstLineIndent().run();
        },
      },
      {
        id: "editor.decreaseFirstLineIndent",
        allowInInput: true,
        onTrigger: () => {
          if (!editor) return;
          editor.chain().focus().decreaseFirstLineIndent().run();
        },
      },
      {
        id: "editor.removeFormatting",
        allowInInput: true,
        onTrigger: () => {
          if (!editor) return;
          editor.chain().focus().unsetAllMarks().clearNodes().run();
        },
      },
      {
        id: "editor.spellCheck",
        allowInInput: true,
        onTrigger: () => setSpellCheckEnabled(!spellCheckEnabled),
      },
      {
        id: "editor.downloadSpellCheckDictionary",
        allowInInput: true,
        onTrigger: () => {
          const state = useSpellCheckDictionaries.getState();
          const status = dictionaryStatus(spellCheckLanguage, state);
          if (status.kind === "available") void state.download(status.entry.language);
        },
      },
      {
        id: "editor.textColor",
        allowInInput: true,
        onTrigger: () => {
          if (!editor) return;
          const current = editor.getAttributes("textStyle").color as string | undefined;
          if (current) editor.chain().focus().unsetColor().run();
          else editor.chain().focus().setColor("#000000").run();
        },
      },
    ],
    { enabled: isActiveEditor }
  );

  const isOverlayOpen =
    showFindReplace ||
    showImageDialog ||
    showFootnoteDialog ||
    showLinkDialog ||
    showDictionaryDialog ||
    showDictionaryPrompt ||
    showSymbolsDialog;

  const findReplace = editor ? (
    <FindReplace
      editor={editor}
      isOpen={showFindReplace}
      onClose={() => setShowFindReplace(false)}
      focusSignal={findReplaceFocusSignal}
      handoff={findHandoff}
    />
  ) : null;

  const surface = editor ? (
    <>
      {findContainer ? createPortal(findReplace, findContainer) : findReplace}
      <ImageInsertDialog
        editor={editor}
        isOpen={showImageDialog}
        onClose={() => setShowImageDialog(false)}
      />
      <FootnoteDialog
        editor={editor}
        isOpen={showFootnoteDialog}
        onClose={() => setShowFootnoteDialog(false)}
      />
      <LinkDialog
        editor={editor}
        isOpen={showLinkDialog}
        onClose={() => setShowLinkDialog(false)}
        bookId={bookId}
        internalTargets={internalTargets}
        loadInternalTargetChildren={loadInternalTargetChildren}
      />
      <DictionaryDialog
        isOpen={showDictionaryDialog}
        word={dictionaryWord}
        language={spellCheckLanguage}
        onClose={() => setShowDictionaryDialog(false)}
        restoreFocusTarget={() => editor.view.dom}
      />
      <DictionaryPromptDialog
        isOpen={showDictionaryPrompt}
        defaultLanguage={spellCheckLanguage}
        openInBrowser={dictionaryOpenInBrowser}
        onOpenInBrowserChange={setDictionaryOpenInBrowser}
        onClose={() => setShowDictionaryPrompt(false)}
        onSubmit={(word, language) => handleLookupWord(word, language)}
      />
      <SymbolsDialog
        editor={editor}
        isOpen={showSymbolsDialog}
        onClose={() => setShowSymbolsDialog(false)}
      />
    </>
  ) : null;

  return {
    openFindReplace,
    closeFindReplace: () => setShowFindReplace(false),
    isFindReplaceOpen: showFindReplace,
    openLinkDialog: () => setShowLinkDialog(true),
    openImageDialog: () => setShowImageDialog(true),
    openFootnote: () => setShowFootnoteDialog(true),
    openSymbols: () => setShowSymbolsDialog(true),
    openDictionary: handleOpenDictionary,
    lookupWord: handleLookupWord,
    isOverlayOpen,
    surface,
  };
}
