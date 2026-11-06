import { useState, useEffect, useRef, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import {
  type InternalTarget,
  type InternalTargetChildrenLoader,
} from "@/components/editor/LinkDialog";
import { HtmlViewPanel } from "@/components/editor/HtmlViewPanel";
import { EditorContextMenu } from "@/components/editor/EditorContextMenu";
import { findBlockOffsetInHtml } from "@/components/editor/HtmlInspectMenu";
import { TooltipGroup } from "@/components/ui";
import { ShortcutsHelpDialog } from "@/components/ShortcutsHelpDialog";
import { ShortcutEditorDialog } from "@/components/shortcuts/ShortcutEditorDialog";
import { ResponsiveEditorToolbar } from "@/components/editor/toolbar/ResponsiveEditorToolbar";
import { ToolbarSettingsDialog } from "@/components/editor/toolbar/ToolbarSettingsDialog";
import {
  ToolbarFixedUtilities,
  ToolbarUtilityCluster,
} from "@/components/editor/toolbar/ToolbarUtilities";
import { useTranslation } from "react-i18next";
import {
  dictionaryStatusText,
  type ToolbarGroupCallbacks,
} from "@/components/editor/toolbar/EditorToolbarGroups";
import { useSettingsStore } from "@/features/settings/store";
import { dictionaryStatus, useSpellCheckDictionaries } from "@/features/spell-check-dictionaries";
import type { SearchHandoff } from "@/features/search/types";
import type { WritingLanguage } from "@/lib/writing-language";
import { isModKey } from "@/lib/keyboard";
import { useShortcuts } from "@/lib/shortcuts";
import { useEditorSurface } from "@/components/editor/EditorSurface";

interface EditorToolbarProps {
  editor: Editor;
  onContextMenuOpenChange?: (open: boolean) => void;
  bookId?: string | null;
  spellCheckLanguage: WritingLanguage;
  onSpellCheckLanguageChange?: (language: WritingLanguage) => void;
  internalTargets?: InternalTarget[];
  loadInternalTargetChildren?: InternalTargetChildrenLoader;
  onExportMarkdown?: () => void;
  onExportPdf?: () => void;
  onExportImage?: () => void;
  /** Esc inside the toolbar hands focus back to the Chapter text. */
  onExitToolbar?: () => void;
  /** The Tutorial step that points at this toolbar, if any. */
  tutorialAnchor?: string;
  /**
   * A Library Search text row opened this editor: open Find and Replace with
   * its query. One-shot per object identity, so Back/Forward (whose history
   * entries carry no handoff) never reopens it. Reported through
   * `onHandoffApplied`, which is when the page clears it: clearing on chapter
   * match instead would drop a handoff that arrives before the editor (and
   * this toolbar) has mounted.
   */
  findHandoff?: SearchHandoff | null;
  /** The handoff above opened Find and Replace; the page clears it now. */
  onHandoffApplied?: () => void;
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
  onExitToolbar,
  tutorialAnchor,
  findHandoff = null,
  onHandoffApplied,
}: EditorToolbarProps) {
  const [showHtmlPanel, setShowHtmlPanel] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showShortcutEditor, setShowShortcutEditor] = useState(false);
  const [showToolbarSettings, setShowToolbarSettings] = useState(false);
  const openShortcutsHelp = useCallback(() => {
    setShowShortcutsHelp(true);
  }, []);
  const [isToolbarExpanded, setIsToolbarExpanded] = [
    useSettingsStore((state) => state.toolbarExpanded),
    useSettingsStore((state) => state.setToolbarExpanded),
  ];
  const { t } = useTranslation();
  const dictionaries = useSpellCheckDictionaries();
  const dictionaryText = dictionaryStatusText(
    dictionaryStatus(spellCheckLanguage, dictionaries),
    t
  );
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

  const {
    openFindReplace,
    closeFindReplace,
    isFindReplaceOpen,
    openLinkDialog,
    openImageDialog,
    openFootnote,
    openSymbols,
    openDictionary,
    lookupWord,
    surface,
  } = useEditorSurface(editor, {
    bookId,
    spellCheckLanguage,
    internalTargets,
    loadInternalTargetChildren,
    findHandoff,
    onHandoffApplied,
  });

  const handleSpellCheckLanguageChange = useCallback(
    (nextLanguage: WritingLanguage) => {
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
      id: "editor.toolbarSettings",
      allowInInput: true,
      onTrigger: () => setShowToolbarSettings(true),
    },
    {
      id: "editor.viewHtml",
      allowInInput: true,
      onTrigger: () => setShowHtmlPanel(true),
    },
    {
      id: "editor.exportMarkdown",
      enabled: !!onExportMarkdown,
      onTrigger: () => onExportMarkdown?.(),
    },
    {
      id: "editor.exportPdf",
      enabled: !!onExportPdf,
      onTrigger: () => onExportPdf?.(),
    },
    {
      id: "editor.exportImage",
      enabled: !!onExportImage,
      onTrigger: () => onExportImage?.(),
    },
  ]);

  const callbacks: ToolbarGroupCallbacks = {
    bookId,
    spellCheckLanguage,
    onSpellCheckLanguageChange: handleSpellCheckLanguageChange,
    openFindReplace,
    isFindReplaceOpen,
    onToggleFindReplace: closeFindReplace,
    openImageDialog,
    openFootnote,
    openLinkDialog,
    openDictionary,
    openSymbols,
    openHtmlPanel: () => setShowHtmlPanel(true),
    onExportMarkdown,
    onExportPdf,
    onExportImage,
  };

  return (
    <TooltipGroup>
      <span role="status" className="sr-only">
        {dictionaryText}
      </span>
      <div
        className="border-b border-border bg-background sticky top-0 z-10"
        data-tutorial={tutorialAnchor}
      >
        <ResponsiveEditorToolbar
          editor={editor}
          callbacks={callbacks}
          onExitToolbar={onExitToolbar}
          utilityCluster={
            <ToolbarUtilityCluster
              onShortcutsHelp={openShortcutsHelp}
              onToolbarSettings={() => setShowToolbarSettings(true)}
            />
          }
          fixedUtilities={
            <ToolbarFixedUtilities
              isExpanded={isToolbarExpanded}
              onToggleExpanded={() => setIsToolbarExpanded(!isToolbarExpanded)}
            />
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
          onLookup={lookupWord}
          onEditLink={openLinkDialog}
          onOpenChange={onContextMenuOpenChange}
        />
        {surface}
        <ShortcutsHelpDialog
          isOpen={showShortcutsHelp}
          onClose={() => setShowShortcutsHelp(false)}
          onCustomize={() => {
            setShowShortcutsHelp(false);
            setShowShortcutEditor(true);
          }}
        />
        <ShortcutEditorDialog
          isOpen={showShortcutEditor}
          onClose={() => {
            setShowShortcutEditor(false);
            setShowShortcutsHelp(true);
          }}
        />
        <ToolbarSettingsDialog
          editor={editor}
          isOpen={showToolbarSettings}
          onClose={() => setShowToolbarSettings(false)}
        />
      </div>
    </TooltipGroup>
  );
}
