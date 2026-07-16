import { useState, useEffect, useRef, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { FindReplace } from "@/components/editor/FindReplace";
import { ImageInsertDialog } from "@/components/editor/ImageInsertDialog";
import { FootnoteDialog } from "@/components/editor/FootnoteDialog";
import {
  LinkDialog,
  type InternalTarget,
  type InternalTargetChildrenLoader,
} from "@/components/editor/LinkDialog";
import { HtmlViewPanel } from "@/components/editor/HtmlViewPanel";
import { EditorContextMenu } from "@/components/editor/EditorContextMenu";
import { findBlockOffsetInHtml } from "@/components/editor/HtmlInspectMenu";
import { ToolbarButton, Divider } from "@/components/editor/ToolbarButton";
import { Tooltip, TooltipGroup } from "@/components/ui";
import { ZoomControl } from "@/components/editor/ZoomControl";
import { WidthControl } from "@/components/editor/WidthControl";
import { DictionaryDialog } from "@/components/editor/DictionaryDialog";
import { DictionaryPromptDialog } from "@/components/editor/DictionaryPromptDialog";
import { ShortcutsHelpDialog } from "@/components/ShortcutsHelpDialog";
import { ResponsiveEditorToolbar } from "@/components/editor/toolbar/ResponsiveEditorToolbar";
import { ToolbarSettingsDialog } from "@/components/editor/toolbar/ToolbarSettingsDialog";
import type { ToolbarGroupCallbacks } from "@/components/editor/toolbar/EditorToolbarGroups";
import { useActiveShortcuts } from "@/hooks";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/features/settings/store";
import type { Language } from "@/features/settings/types";
import { openExternal } from "@/lib/platform";
import { isModKey } from "@/lib/keyboard";
import { useShortcuts } from "@/lib/shortcuts";
import { matchKeys } from "@/lib/shortcut-registry";
import { ChevronDown, ChevronUp, Settings2 } from "lucide-react";

interface EditorToolbarProps {
  editor: Editor;
  onContextMenuOpenChange?: (open: boolean) => void;
  bookId?: string | null;
  spellCheckLanguage: Language;
  onSpellCheckLanguageChange?: (language: Language) => void;
  internalTargets?: InternalTarget[];
  loadInternalTargetChildren?: InternalTargetChildrenLoader;
  onExportMarkdown?: () => void;
  onExportPdf?: () => void;
  onExportImage?: () => void;
}

export function EditorToolbar({
  editor,
  onContextMenuOpenChange,
  bookId,
  spellCheckLanguage,
  onSpellCheckLanguageChange,
  internalTargets,
  loadInternalTargetChildren,
  onExportMarkdown,
  onExportPdf,
  onExportImage,
}: EditorToolbarProps) {
  const { t } = useTranslation();
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findReplaceFocusSignal, setFindReplaceFocusSignal] = useState(0);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [showFootnoteDialog, setShowFootnoteDialog] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showHtmlPanel, setShowHtmlPanel] = useState(false);
  const [showDictionaryDialog, setShowDictionaryDialog] = useState(false);
  const [showDictionaryPrompt, setShowDictionaryPrompt] = useState(false);
  const [dictionaryWord, setDictionaryWord] = useState("");
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showToolbarSettings, setShowToolbarSettings] = useState(false);
  const shortcuts = useActiveShortcuts();
  const [isToolbarExpanded, setIsToolbarExpanded] = [
    useSettingsStore((state) => state.toolbarExpanded),
    useSettingsStore((state) => state.setToolbarExpanded),
  ];
  const showNotesChapter = useSettingsStore((state) => state.showNotesChapter);
  const setShowNotesChapter = useSettingsStore((state) => state.setShowNotesChapter);
  const bookSidePanelTab = useSettingsStore((state) => state.bookSidePanelTab);
  const setBookSidePanelTab = useSettingsStore((state) => state.setBookSidePanelTab);
  const dictionaryOpenInBrowser = useSettingsStore((state) => state.dictionaryOpenInBrowser);
  const setDictionaryOpenInBrowser = useSettingsStore((state) => state.setDictionaryOpenInBrowser);

  // Track editor focus with a delayed blur so toolbar clicks still read it as focused
  const editorWasFocusedRef = useRef(false);
  const showHtmlPanelRef = useRef(showHtmlPanel);
  showHtmlPanelRef.current = showHtmlPanel;
  const htmlPanelHandleRef = useRef<{
    highlightRange: (from: number, to: number) => void;
  } | null>(null);
  const pendingInspectRef = useRef<number | null>(null);

  const handleInspect = useCallback(
    (blockIndex: number) => {
      // Open panel if not already open
      if (!showHtmlPanelRef.current) {
        setShowHtmlPanel(true);
      }

      // If handle is ready, highlight immediately; otherwise queue it for onReady
      const html = editor.getHTML();
      const range = findBlockOffsetInHtml(html, blockIndex);
      if (range && htmlPanelHandleRef.current) {
        htmlPanelHandleRef.current.highlightRange(range.from, range.to);
      } else {
        pendingInspectRef.current = blockIndex;
      }
    },
    [editor]
  );

  const openFindReplace = useCallback(() => {
    setShowFindReplace(true);
    setFindReplaceFocusSignal((current) => current + 1);
  }, []);

  const handleHtmlPanelReady = useCallback(
    (handle: { highlightRange: (from: number, to: number) => void } | null) => {
      htmlPanelHandleRef.current = handle;
      if (handle && pendingInspectRef.current !== null) {
        const html = editor.getHTML();
        const range = findBlockOffsetInHtml(html, pendingInspectRef.current);
        if (range) {
          handle.highlightRange(range.from, range.to);
        }
        pendingInspectRef.current = null;
      }
    },
    [editor]
  );
  useEffect(() => {
    const dom = editor.view.dom;
    const onFocus = () => {
      editorWasFocusedRef.current = true;
    };
    const onBlur = () => {
      setTimeout(() => {
        editorWasFocusedRef.current = false;
      }, 150);
    };
    dom.addEventListener("focus", onFocus);
    dom.addEventListener("blur", onBlur);
    return () => {
      dom.removeEventListener("focus", onFocus);
      dom.removeEventListener("blur", onBlur);
    };
  }, [editor]);

  const handleOpenDictionary = () => {
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ").trim();
    if (!selectedText) {
      setShowDictionaryPrompt(true);
      return;
    }
    const word = selectedText.split(/\s+/)[0];
    if (!word) return;
    handleLookupWord(word);
  };

  const handleLookupWord = useCallback(
    (word: string, language: Language = spellCheckLanguage) => {
      if (dictionaryOpenInBrowser) {
        const url = `https://${language}.wiktionary.org/wiki/${encodeURIComponent(word)}`;
        openExternal(url);
        return;
      }
      setDictionaryWord(word);
      setShowDictionaryDialog(true);
    },
    [dictionaryOpenInBrowser, spellCheckLanguage]
  );

  const handleSpellCheckLanguageChange = useCallback(
    (nextLanguage: Language) => {
      editor.commands.setSpellCheckLanguage(nextLanguage);
      onSpellCheckLanguageChange?.(nextLanguage);
    },
    [editor, onSpellCheckLanguageChange]
  );

  useEffect(() => {
    const dom = editor.view.dom;

    const handleEditorKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || !isModKey(event)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "k") {
        event.preventDefault();
        setShowLinkDialog(true);
        return;
      }

      if (event.altKey && key === "n") {
        event.preventDefault();
        setShowFootnoteDialog(true);
      }

      if (event.shiftKey && key === "u") {
        event.preventDefault();
        setShowHtmlPanel(!showHtmlPanelRef.current);
        return;
      }
    };

    dom.addEventListener("keydown", handleEditorKeyDown);
    return () => {
      dom.removeEventListener("keydown", handleEditorKeyDown);
    };
  }, [editor]);

  useShortcuts([
    {
      keys: matchKeys("editor.findReplace"),
      allowInInput: true,
      onTrigger: openFindReplace,
    },
    {
      keys: matchKeys("editor.dictionary"),
      allowInInput: true,
      onTrigger: handleOpenDictionary,
    },
    {
      keys: matchKeys("editor.toolbarSettings"),
      allowInInput: true,
      onTrigger: () => setShowToolbarSettings(true),
    },
  ]);

  const callbacks: ToolbarGroupCallbacks = {
    bookId,
    spellCheckLanguage,
    onSpellCheckLanguageChange: handleSpellCheckLanguageChange,
    openFindReplace,
    isFindReplaceOpen: showFindReplace,
    onToggleFindReplace: () => setShowFindReplace(false),
    openImageDialog: () => setShowImageDialog(true),
    openFootnote: () => {
      if (editorWasFocusedRef.current) {
        setShowFootnoteDialog(true);
      } else if (showNotesChapter && bookSidePanelTab === "footnotes") {
        setShowNotesChapter(false);
      } else {
        setBookSidePanelTab("footnotes");
        setShowNotesChapter(true);
      }
    },
    openLinkDialog: () => setShowLinkDialog(true),
    openDictionary: handleOpenDictionary,
    openHtmlPanel: () => setShowHtmlPanel(true),
    onExportMarkdown,
    onExportPdf,
    onExportImage,
  };

  return (
    <TooltipGroup>
      <div className="border-b border-border bg-background sticky top-0 z-10">
        <ResponsiveEditorToolbar
          editor={editor}
          callbacks={callbacks}
          utilityCluster={
            <>
              <ToolbarButton
                onClick={() => setShowShortcutsHelp(true)}
                label={t("shortcuts.title")}
              >
                <span className="w-4 h-4 flex items-center justify-center font-bold">?</span>
              </ToolbarButton>
              <Divider />
              <ToolbarButton
                onClick={() => setShowToolbarSettings(true)}
                label={t("toolbar.settings.open")}
                shortcut="editor.toolbarSettings"
              >
                <Settings2 className="w-4 h-4" />
              </ToolbarButton>
            </>
          }
          fixedUtilities={
            <div className="flex items-center gap-0.5">
              <WidthControl />
              <Divider />
              <ZoomControl />
              <Tooltip
                content={isToolbarExpanded ? t("editor.hideToolbar") : t("editor.showToolbar")}
              >
                <button
                  type="button"
                  onClick={() => setIsToolbarExpanded(!isToolbarExpanded)}
                  className="p-2 rounded hover:bg-muted transition-colors"
                  aria-label={isToolbarExpanded ? t("editor.hideToolbar") : t("editor.showToolbar")}
                >
                  {isToolbarExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              </Tooltip>
            </div>
          }
        />

        {/* Panels and Dialogs */}
        {showHtmlPanel && (
          <HtmlViewPanel
            editor={editor}
            isOpen={showHtmlPanel}
            onClose={() => {
              setShowHtmlPanel(false);
              htmlPanelHandleRef.current = null;
              pendingInspectRef.current = null;
            }}
            onReady={handleHtmlPanelReady}
          />
        )}
        <EditorContextMenu
          editor={editor}
          onInspect={handleInspect}
          onLookup={handleLookupWord}
          onEditLink={() => setShowLinkDialog(true)}
          onOpenChange={onContextMenuOpenChange}
        />
        <FindReplace
          editor={editor}
          isOpen={showFindReplace}
          onClose={() => setShowFindReplace(false)}
          focusSignal={findReplaceFocusSignal}
        />
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
        />
        <DictionaryPromptDialog
          isOpen={showDictionaryPrompt}
          defaultLanguage={spellCheckLanguage}
          openInBrowser={dictionaryOpenInBrowser}
          onOpenInBrowserChange={setDictionaryOpenInBrowser}
          onClose={() => setShowDictionaryPrompt(false)}
          onSubmit={(word, language) => handleLookupWord(word, language)}
        />
        <ShortcutsHelpDialog
          isOpen={showShortcutsHelp}
          onClose={() => setShowShortcutsHelp(false)}
          title={t("shortcuts.title")}
          shortcuts={shortcuts}
        />
        <ToolbarSettingsDialog
          isOpen={showToolbarSettings}
          onClose={() => setShowToolbarSettings(false)}
        />
      </div>
    </TooltipGroup>
  );
}
