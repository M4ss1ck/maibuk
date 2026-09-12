import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor as TiptapEditor, Extensions } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import {
  useEffect,
  useCallback,
  useRef,
  useState,
  useMemo,
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { SelectionToolbar } from "@/components/editor/SelectionToolbar";
import { LinkClickHandler } from "@/components/editor/LinkClickHandler";
import { LinkDialog } from "@/components/editor/LinkDialog";
import { ImageContextMenu } from "@/components/editor/ImageContextMenu";
import { FootnoteList } from "@/components/editor/FootnoteList";
import { SearchReplace } from "@/components/editor/extensions/SearchReplace";
import { MetricsObserver } from "@/components/editor/extensions/MetricsObserver";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/features/settings/store";
import type { Language } from "@/features/settings/types";
import { useChapterStore } from "@/features/chapters/store";
import { useReadingPosition } from "@/features/reading-position/useReadingPosition";
import { useEditorZoomControls } from "@/components/editor/useEditorZoomControls";
import { assignHeadingIds } from "@/features/links/heading-ids";
import type { InternalTarget, InternalTargetChildrenLoader } from "@/components/editor/LinkDialog";
import { setContentSilently } from "@/features/metrics/programmatic";
import { MarkdownPasteDialog } from "@/components/editor/MarkdownPasteDialog";
import { buildDropHtml } from "@/components/editor/file-drop-html";
import { textDropExtension } from "@/features/markdown/dropped-file";
import { readDroppedWebFiles } from "@/hooks/useTextFileDrop";
import { useEditorFileDrop } from "@/components/editor/useEditorFileDrop";
import { IS_TAURI } from "@/lib/platform";

/**
 * How many recent editor emissions to retain for stale-echo detection. The
 * store's async, debounced round-trip only lags the live document by a handful
 * of keystrokes, so a small window is ample.
 */
const MAX_RECENT_EMITTED = 30;
/**
 * How long a burst of keystrokes coalesces into one serialization. Serializing
 * the document and counting its words costs time proportional to chapter length
 * (~10ms per keystroke on a 150k-character chapter on Android), and every
 * consumer of that work is already debounced far longer than this: the chapter
 * store saves after 1000ms and the word counter is display-only. Explicit flush
 * points (blur, unmount, chapter switch) drain the pending work synchronously,
 * so nothing downstream ever reads a stale document.
 */
const EMIT_COALESCE_MS = 300;
const EMPTY_INTERNAL_TARGETS: InternalTarget[] = [];
// Parent statistics update while typing; toolbar state has its own subscriptions.
const MemoizedEditorToolbar = memo(EditorToolbar);

/**
 * Serialize HTML with heading ids stripped, parsing through a single serializer
 * so attribute order and whitespace are normalized consistently for comparison.
 */
const strippedCache = new Map<string, string>();

/**
 * `stripHeadingIds` for repeated comparisons against the same strings. Echo
 * detection compares one incoming document against up to MAX_RECENT_EMITTED
 * previous emissions, and parsing a long chapter that many times is the kind of
 * work that shows up as input lag.
 */
function stripHeadingIdsCached(html: string): string {
  const hit = strippedCache.get(html);
  if (hit !== undefined) return hit;
  const stripped = stripHeadingIds(html);
  if (strippedCache.size > MAX_RECENT_EMITTED * 2) strippedCache.clear();
  strippedCache.set(html, stripped);
  return stripped;
}

function stripHeadingIds(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const heading of doc.body.querySelectorAll("h1, h2, h3")) {
    heading.removeAttribute("id");
  }
  return doc.body.innerHTML;
}

export interface EditorStats {
  words: number;
  characters: number;
  hasSelection: boolean;
}

interface EditorProps {
  content: string | null;
  onUpdate: (content: string) => void;
  /**
   * Fired after a genuinely external `content` change (a sync pull, a version
   * restore) replaced the document. Parents that cache the latest HTML for
   * saving must adopt it here, and drop any save queued for the old text.
   */
  onExternalContent?: (content: string, wordCount: number) => void;
  onWordCountChange?: (count: number) => void;
  onStatsChange?: (stats: EditorStats) => void;
  onBlur?: () => void;
  placeholder?: string;
  editable?: boolean;
  focusMode?: boolean;
  footnoteStartIndex?: number;
  showInlineFootnotes?: boolean;
  bookId?: string | null;
  chapterId?: string | null;
  /** Namespaced reading-position key, e.g. `chapter:<id>` / `note:<id>`. */
  restoreKey?: string | null;
  /** Skip position restore when an explicit deep-link scroll is in play. */
  suppressRestore?: boolean;
  internalTargets?: InternalTarget[];
  loadInternalTargetChildren?: InternalTargetChildrenLoader;
  extraExtensions?: Extensions;
  headerContent?: React.ReactNode;
  onEditorReady?: (editor: TiptapEditor | null) => void;
  spellCheckLanguage?: Language;
  onSpellCheckLanguageChange?: (language: Language) => void;
  onExportMarkdown?: () => void;
  onExportPdf?: () => void;
  onExportImage?: () => void;
  onEscape?: () => void;
}

export function Editor({
  content,
  onUpdate,
  onExternalContent,
  onWordCountChange,
  onStatsChange,
  onBlur,
  placeholder = "Start writing your chapter...",
  editable = true,
  focusMode = false,
  footnoteStartIndex = 1,
  showInlineFootnotes = true,
  bookId = null,
  chapterId = null,
  restoreKey = null,
  suppressRestore = false,
  internalTargets: providedInternalTargets = EMPTY_INTERNAL_TARGETS,
  loadInternalTargetChildren: providedLoadInternalTargetChildren,
  extraExtensions,
  headerContent,
  onEditorReady,
  spellCheckLanguage,
  onSpellCheckLanguageChange,
  onExportMarkdown,
  onExportPdf,
  onExportImage,
  onEscape,
}: EditorProps) {
  const { t } = useTranslation();
  const spellCheckEnabled = useSettingsStore((state) => state.spellCheckEnabled);
  const settingsLanguage = useSettingsStore((state) => state.language);
  const activeSpellCheckLanguage = spellCheckLanguage ?? settingsLanguage;
  const editorShowBorder = useSettingsStore((state) => state.editorShowBorder);
  const editorAutoClose = useSettingsStore((state) => state.editorAutoClose);
  const [showBubbleLinkDialog, setShowBubbleLinkDialog] = useState(false);
  const [pendingMarkdownPaste, setPendingMarkdownPaste] = useState<string | null>(null);
  const [scrollContainerEl, setScrollContainerEl] = useState<HTMLDivElement | null>(null);
  const showBubbleLinkDialogRef = useRef(showBubbleLinkDialog);
  const pendingMarkdownPasteRef = useRef(pendingMarkdownPaste);
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    showBubbleLinkDialogRef.current = showBubbleLinkDialog;
  }, [showBubbleLinkDialog]);

  useEffect(() => {
    pendingMarkdownPasteRef.current = pendingMarkdownPaste;
  }, [pendingMarkdownPaste]);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);
  useEditorZoomControls(scrollContainerEl);
  const handleMarkdownPaste = useCallback((text: string) => {
    setPendingMarkdownPaste(text);
  }, []);
  const chapters = useChapterStore((s) => s.chapters);
  const internalTargets = useMemo<InternalTarget[]>(
    () => [
      ...providedInternalTargets,
      ...(bookId
        ? chapters.map((c) => ({
            type: "chapter" as const,
            chapterId: c.id,
            title: c.title,
            headingId: null,
          }))
        : []),
    ],
    [providedInternalTargets, bookId, chapters]
  );
  const loadInternalTargetChildren = useCallback<InternalTargetChildrenLoader>(
    async (target) => {
      if (providedLoadInternalTargetChildren) {
        return providedLoadInternalTargetChildren(target);
      }

      if (target.type !== "chapter") return [];
      const chapter = chapters.find((candidate) => candidate.id === target.chapterId);
      if (!chapter) return [];

      return assignHeadingIds(chapter.content).headings.map((heading) => ({
        type: "heading" as const,
        chapterId: chapter.id,
        title: heading.text,
        headingId: heading.id,
      }));
    },
    [chapters, providedLoadInternalTargetChildren]
  );
  const appliedContentRef = useRef(content);
  // Recent HTML the editor has emitted, newest last. The chapter store saves
  // debounced snapshots and echoes their normalized form back through `content`
  // asynchronously, so an echo can arrive after the user has typed further. Such
  // a stale echo differs from the editor's *current* document but still matches
  // one of these recent emissions — the signal that it is the editor's own
  // output rather than a genuine external change.
  const recentEmittedRef = useRef<string[]>([]);
  const editorInstanceRef = useRef<TiptapEditor | null>(null);

  // The coalesced emitter runs from a timer, so it reads the callbacks through
  // refs rather than capturing whichever render scheduled it.
  const onUpdateRef = useRef(onUpdate);
  const onExternalContentRef = useRef(onExternalContent);
  const onWordCountChangeRef = useRef(onWordCountChange);
  const onStatsChangeRef = useRef(onStatsChange);
  onUpdateRef.current = onUpdate;
  onExternalContentRef.current = onExternalContent;
  onWordCountChangeRef.current = onWordCountChange;
  onStatsChangeRef.current = onStatsChange;

  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentDirtyRef = useRef(false);
  const statsDirtyRef = useRef(false);

  /**
   * Serialize the document, count its words, and hand both to the parent. This
   * is everything on the edit path whose cost grows with chapter length, which
   * is why it runs once per burst instead of once per keystroke.
   */
  const runEmit = useCallback(() => {
    if (emitTimerRef.current !== null) {
      clearTimeout(emitTimerRef.current);
      emitTimerRef.current = null;
    }
    const editor = editorInstanceRef.current;
    if (!editor || editor.isDestroyed) {
      contentDirtyRef.current = false;
      statsDirtyRef.current = false;
      return;
    }

    // Counting the whole document is the expensive half; both consumers below
    // want the same number, so it is counted at most once per burst.
    let documentWords: number | null = null;
    const countWords = () => {
      documentWords ??= editor.storage.characterCount.words();
      return documentWords;
    };

    if (contentDirtyRef.current) {
      contentDirtyRef.current = false;
      const html = editor.getHTML();
      appliedContentRef.current = html;
      const recent = recentEmittedRef.current;
      recent.push(html);
      if (recent.length > MAX_RECENT_EMITTED) recent.shift();
      onUpdateRef.current(html);
      onWordCountChangeRef.current?.(countWords());
    }

    if (statsDirtyRef.current) {
      statsDirtyRef.current = false;
      const onStatsChange = onStatsChangeRef.current;
      if (onStatsChange) {
        const { from, to } = editor.state.selection;
        if (from !== to) {
          const selectedText = editor.state.doc.textBetween(from, to, " ");
          const words = selectedText
            .trim()
            .split(/\s+/)
            .filter((word) => word.length > 0).length;
          onStatsChange({ words, characters: selectedText.length, hasSelection: true });
        } else {
          onStatsChange({
            words: countWords(),
            characters: editor.storage.characterCount.characters(),
            hasSelection: false,
          });
        }
      }
    }
  }, []);

  const scheduleEmit = useCallback(
    (kind: "content" | "stats") => {
      if (kind === "content") contentDirtyRef.current = true;
      statsDirtyRef.current = true;
      if (emitTimerRef.current !== null) return;
      emitTimerRef.current = setTimeout(runEmit, EMIT_COALESCE_MS);
    },
    [runEmit]
  );

  // Anything that reads the saved document must see the newest keystrokes, so
  // drain the pending burst before the editor goes away or loses focus.
  useEffect(() => () => runEmit(), [runEmit]);

  // Android kills backgrounded apps without warning, and coalescing would
  // otherwise hold the last keystrokes of a burst past that point.
  useEffect(() => {
    const flushIfHidden = () => {
      if (document.visibilityState === "hidden") runEmit();
    };
    document.addEventListener("visibilitychange", flushIfHidden);
    return () => document.removeEventListener("visibilitychange", flushIfHidden);
  }, [runEmit]);

  const editor = useEditor({
    extensions: [
      ...createRichTextExtensions({
        onMarkdownPaste: handleMarkdownPaste,
        footnoteStartIndex,
        spellCheck: { enabled: spellCheckEnabled, language: activeSpellCheckLanguage },
        autoClose: editorAutoClose,
        dropcursor: !IS_TAURI,
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
      }),
      CharacterCount,
      SearchReplace,
      MetricsObserver.configure({
        workId: bookId,
        chapterId,
      }),
      ...(extraExtensions ?? []),
    ],
    content: content || "",
    editable,
    editorProps: {
      attributes: {
        class: "editor-content outline-none min-h-[500px]",
      },
      handleKeyDown: (_view, event) => {
        if (event.key !== "Escape") return false;
        if (showBubbleLinkDialogRef.current || pendingMarkdownPasteRef.current) {
          return false;
        }
        const handler = onEscapeRef.current;
        if (handler) {
          handler();
          return true;
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !editable) return false;
        const all = Array.from(event.dataTransfer?.files ?? []);
        const supported = all.filter((file) => textDropExtension(file.name) !== null);
        if (supported.length === 0) return false;

        event.preventDefault();
        const coords = { left: event.clientX, top: event.clientY };
        void (async () => {
          const files = await readDroppedWebFiles(all);
          const html = buildDropHtml(files);
          if (!html) return;
          const editorInstance = editorInstanceRef.current;
          if (!editorInstance) return;
          const pos = view.posAtCoords(coords)?.pos ?? editorInstance.state.selection.to;
          editorInstance.chain().focus().insertContentAt(pos, html).run();
        })();
        return true;
      },
    },
    onUpdate: () => scheduleEmit("content"),
  });
  editorInstanceRef.current = editor;

  // Expose the editor instance to parents (e.g. the table-of-contents panel)
  useEffect(() => {
    onEditorReady?.(editor ?? null);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  useEditorFileDrop(editor, editable);

  // Update content when it changes externally (e.g., switching chapters)
  useEffect(() => {
    if (!editor || content === null) return;
    // A queued burst may already hold this exact document; emitting it first
    // keeps the echo check below from mistaking our own text for an edit made
    // elsewhere and resetting the caret mid-sentence.
    if (contentDirtyRef.current) runEmit();
    if (appliedContentRef.current === content) return;

    // The chapter store echoes saved HTML back through `content` after stamping
    // heading ids onto it (assignHeadingIds). That echo is the editor's own
    // document, not an external change, so adopt it as applied without resetting
    // — otherwise the caret jumps away mid-edit. Because the store saves
    // debounced snapshots asynchronously, the echo can also be *stale*: it may
    // arrive after the user has typed further, so it no longer matches the
    // editor's current document. Recognize it by comparing against recent
    // emissions too. Genuinely external content (e.g. a version restore) matches
    // neither and still gets applied.
    const incomingStripped = stripHeadingIdsCached(content);
    const isOwnEcho =
      recentEmittedRef.current.some((html) => stripHeadingIdsCached(html) === incomingStripped) ||
      incomingStripped === stripHeadingIds(editor.getHTML());
    if (isOwnEcho) {
      appliedContentRef.current = content;
      return;
    }

    setContentSilently(editor, content);
    appliedContentRef.current = content;
    // External content replaced the document; prior edit history is obsolete.
    recentEmittedRef.current = [];
    // setContentSilently suppresses onUpdate, so tell the parent explicitly.
    onExternalContentRef.current?.(content, editor.storage.characterCount.words());
  }, [editor, content, runEmit]);

  useReadingPosition({
    editor,
    scrollEl: scrollContainerEl,
    storageKey: restoreKey,
    suppressRestore,
  });

  useEffect(() => {
    if (!editor?.commands?.setSpellCheckEnabled) return;
    editor.commands.setSpellCheckEnabled(spellCheckEnabled);
  }, [editor, spellCheckEnabled]);

  useEffect(() => {
    if (!editor?.commands?.setSpellCheckLanguage) return;
    editor.commands.setSpellCheckLanguage(activeSpellCheckLanguage);
  }, [editor, activeSpellCheckLanguage]);

  // Update word count on initial load
  useEffect(() => {
    if (editor && onWordCountChange) {
      const words = editor.storage.characterCount.words();
      onWordCountChange(words);
    }
  }, [editor, onWordCountChange]);

  // A pending burst must reach the parent before anything reads the saved
  // document, and losing focus is when exports, saves and compares happen.
  const handleEditorBlur = useCallback(() => {
    runEmit();
    onBlur?.();
  }, [runEmit, onBlur]);

  // Track selection changes and update stats. Counting words over the whole
  // document costs milliseconds on a long chapter, so it goes through the same
  // coalescing as content emission rather than running per keystroke.
  useEffect(() => {
    if (!editor || !onStatsChange) return;

    const markStatsDirty = () => scheduleEmit("stats");
    runEmit();
    markStatsDirty();

    editor.on("selectionUpdate", markStatsDirty);
    return () => {
      editor.off("selectionUpdate", markStatsDirty);
    };
  }, [editor, onStatsChange, scheduleEmit, runEmit]);

  const handleFocus = useCallback(
    (event: ReactMouseEvent | ReactKeyboardEvent) => {
      const target = event.target;
      if (editor && target instanceof Node && editor.view.dom.contains(target)) {
        return;
      }

      editor?.chain().focus().run();
    },
    [editor]
  );

  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);

  if (!editor) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t("editor.loadingEditor")}</div>
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col min-h-0 ${focusMode ? "focus-mode" : ""}`}>
      {!focusMode && (
        <MemoizedEditorToolbar
          editor={editor}
          onContextMenuOpenChange={setIsContextMenuOpen}
          bookId={bookId}
          spellCheckLanguage={activeSpellCheckLanguage}
          onSpellCheckLanguageChange={onSpellCheckLanguageChange}
          internalTargets={internalTargets}
          loadInternalTargetChildren={loadInternalTargetChildren}
          onExportMarkdown={onExportMarkdown}
          onExportPdf={onExportPdf}
          onExportImage={onExportImage}
        />
      )}

      {headerContent}

      <div
        ref={setScrollContainerEl}
        className="flex-1 overflow-auto min-h-0"
        onClick={handleFocus}
        onKeyDown={handleFocus}
        onBlur={handleEditorBlur}
      >
        <div
          className={`editor-content-surface mx-auto editor-zoom-surface${
            editorShowBorder ? " editor-show-border" : ""
          }`}
        >
          <EditorContent editor={editor} />
          {showInlineFootnotes && <FootnoteList editor={editor} startIndex={footnoteStartIndex} />}
        </div>
      </div>

      <LinkClickHandler editor={editor} />
      <ImageContextMenu editor={editor} />

      {/* Floating selection toolbar — hidden when the context menu is open */}
      {!focusMode && !isContextMenuOpen && (
        <SelectionToolbar editor={editor} onLinkClick={() => setShowBubbleLinkDialog(true)} />
      )}
      <LinkDialog
        editor={editor}
        isOpen={showBubbleLinkDialog}
        onClose={() => setShowBubbleLinkDialog(false)}
        bookId={bookId}
        internalTargets={internalTargets}
        loadInternalTargetChildren={loadInternalTargetChildren}
      />
      <MarkdownPasteDialog
        editor={editor}
        markdown={pendingMarkdownPaste}
        onClose={() => setPendingMarkdownPaste(null)}
      />
    </div>
  );
}
