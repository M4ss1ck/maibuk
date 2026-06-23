import type { Editor } from "@tiptap/react";
import {
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Regex,
  Replace,
  ReplaceAll,
  WholeWord,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { buildSearchRegExp, findMatches, type SearchMatch } from "./extensions/SearchReplace";

interface FindReplaceProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
  focusSignal?: number;
}

function IconButton({
  onClick,
  disabled,
  active,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
        active ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      {children}
    </button>
  );
}

export function FindReplace({ editor, isOpen, onClose, focusSignal = 0 }: FindReplaceProps) {
  const { t } = useTranslation();

  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [regexError, setRegexError] = useState(false);

  const findInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const options = useMemo(
    () => ({ caseSensitive, wholeWord, regex }),
    [caseSensitive, wholeWord, regex]
  );

  const scrollToMatch = useCallback(
    (match: SearchMatch) => {
      // Expand any collapsed heading section the match lives in first.
      // Only present when the CollapsibleHeading extension is loaded.
      editor.commands.revealPosition?.(match.from);
      const { node } = editor.view.domAtPos(match.from);
      const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [editor]
  );

  // Recompute matches against the current document. `preserveIndex` keeps the
  // active match position (clamped) instead of jumping back to the first.
  const recompute = useCallback(
    (preserveIndex: boolean): SearchMatch[] => {
      if (!searchTerm) {
        setRegexError(false);
        setMatches([]);
        setActiveIndex(0);
        return [];
      }

      try {
        buildSearchRegExp(searchTerm, options);
      } catch {
        setRegexError(true);
        setMatches([]);
        setActiveIndex(0);
        return [];
      }

      setRegexError(false);
      const found = findMatches(editor.state.doc, searchTerm, options);
      setMatches(found);
      setActiveIndex((prev) => {
        if (found.length === 0) return 0;
        return preserveIndex ? Math.min(prev, found.length - 1) : 0;
      });
      return found;
    },
    [editor, searchTerm, options]
  );

  // Prefill from the current editor selection when the panel opens.
  useEffect(() => {
    if (!isOpen) return;
    const { from, to } = editor.state.selection;
    if (from !== to) {
      const selected = editor.state.doc.textBetween(from, to);
      if (selected && !selected.includes("\n")) {
        setSearchTerm(selected);
      }
    }
  }, [isOpen, editor]);

  useEffect(() => {
    if (!isOpen) return;
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, [isOpen, focusSignal]);

  // Dismiss when clicking outside the panel.
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isOpen, onClose]);

  // Re-run the search when the query or options change.
  useEffect(() => {
    if (!isOpen) return;
    const found = recompute(false);
    if (found.length > 0) scrollToMatch(found[0]);
  }, [isOpen, recompute, scrollToMatch]);

  // Keep matches in sync when the document changes (typing, replacing, etc.).
  useEffect(() => {
    if (!isOpen) return;
    const handler = () => recompute(true);
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [isOpen, editor, recompute]);

  // Push decorations whenever the match set or active match changes.
  useEffect(() => {
    if (!isOpen) return;
    if (matches.length === 0) {
      editor.commands.clearSearchHighlights();
      return;
    }
    editor.commands.setSearchHighlights({ matches, activeIndex });
  }, [isOpen, editor, matches, activeIndex]);

  // Clear highlights when the panel closes, but preserve the search criteria
  // (query, replacement and toggles) so they are restored on reopen.
  useEffect(() => {
    if (isOpen) return;
    editor.commands.clearSearchHighlights();
    setMatches([]);
  }, [isOpen, editor]);

  const goToMatch = useCallback(
    (index: number) => {
      if (matches.length === 0) return;
      const wrapped = (index + matches.length) % matches.length;
      setActiveIndex(wrapped);
      scrollToMatch(matches[wrapped]);
    },
    [matches, scrollToMatch]
  );

  const findNext = useCallback(() => goToMatch(activeIndex + 1), [goToMatch, activeIndex]);
  const findPrev = useCallback(() => goToMatch(activeIndex - 1), [goToMatch, activeIndex]);

  const replaceRange = useCallback(
    (match: SearchMatch) => {
      const tr = editor.state.tr;
      if (replaceTerm) {
        tr.insertText(replaceTerm, match.from, match.to);
      } else {
        tr.delete(match.from, match.to);
      }
      editor.view.dispatch(tr);
    },
    [editor, replaceTerm]
  );

  const replaceCurrent = useCallback(() => {
    if (matches.length === 0 || regexError) return;
    const index = activeIndex;
    replaceRange(matches[index]);
    const found = findMatches(editor.state.doc, searchTerm, options);
    setMatches(found);
    if (found.length === 0) {
      setActiveIndex(0);
      return;
    }
    const nextIndex = Math.min(index, found.length - 1);
    setActiveIndex(nextIndex);
    scrollToMatch(found[nextIndex]);
  }, [matches, regexError, activeIndex, replaceRange, editor, searchTerm, options, scrollToMatch]);

  const replaceAll = useCallback(() => {
    if (matches.length === 0 || regexError) return;
    const tr = editor.state.tr;
    // Replace from the end so earlier positions stay valid.
    for (const match of [...matches].sort((a, b) => b.from - a.from)) {
      if (replaceTerm) {
        tr.insertText(replaceTerm, match.from, match.to);
      } else {
        tr.delete(match.from, match.to);
      }
    }
    editor.view.dispatch(tr);
    setMatches(findMatches(editor.state.doc, searchTerm, options));
    setActiveIndex(0);
  }, [matches, regexError, replaceTerm, editor, searchTerm, options]);

  // Route editor undo/redo while focus is in the find/replace inputs, so
  // replacements can be reverted without first clicking back into the editor.
  const handleUndoRedo = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (!(e.ctrlKey || e.metaKey)) return false;
    const key = e.key.toLowerCase();
    if (key === "z") {
      e.preventDefault();
      if (e.shiftKey) editor.commands.redo();
      else editor.commands.undo();
      return true;
    }
    if (key === "y") {
      e.preventDefault();
      editor.commands.redo();
      return true;
    }
    return false;
  };

  const handleFindKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (handleUndoRedo(e)) return;
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) findPrev();
      else findNext();
    }
  };

  const handleReplaceKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (handleUndoRedo(e)) return;
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      replaceCurrent();
    }
  };

  if (!isOpen) return null;

  const hasMatches = matches.length > 0;
  const status = regexError
    ? t("editor.invalidRegex")
    : searchTerm
      ? hasMatches
        ? t("editor.matchesOf", {
            current: activeIndex + 1,
            total: matches.length,
          })
        : t("editor.noMatches")
      : "";

  return (
    <div
      ref={panelRef}
      className="absolute top-2 right-2 z-50 flex flex-col gap-1 rounded-md border border-border bg-card p-1.5 shadow-lg"
    >
      {/* Find row */}
      <div className="flex items-center gap-1">
        <div className="relative">
          <input
            ref={findInputRef}
            type="text"
            placeholder={t("editor.find")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleFindKeyDown}
            className={`h-7 w-56 rounded border bg-background pr-[68px] pl-2 text-sm text-foreground outline-none focus:border-primary ${
              regexError ? "border-destructive" : "border-border"
            }`}
          />
          <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
            <IconButton
              active={caseSensitive}
              onClick={() => setCaseSensitive((v) => !v)}
              title={t("editor.matchCase")}
            >
              <CaseSensitive className="h-4 w-4" />
            </IconButton>
            <IconButton
              active={wholeWord}
              onClick={() => setWholeWord((v) => !v)}
              title={t("editor.matchWholeWord")}
            >
              <WholeWord className="h-4 w-4" />
            </IconButton>
            <IconButton
              active={regex}
              onClick={() => setRegex((v) => !v)}
              title={t("editor.useRegex")}
            >
              <Regex className="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        <span className="min-w-[72px] text-center text-xs text-muted-foreground tabular-nums">
          {status}
        </span>

        <IconButton onClick={findPrev} disabled={!hasMatches} title={t("editor.findPrevious")}>
          <ChevronUp className="h-4 w-4" />
        </IconButton>
        <IconButton onClick={findNext} disabled={!hasMatches} title={t("editor.findNext")}>
          <ChevronDown className="h-4 w-4" />
        </IconButton>
        <IconButton onClick={onClose} title={t("editor.closeFindReplace")}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      {/* Replace row */}
      <div className="flex items-center gap-1">
        <input
          type="text"
          placeholder={t("editor.replaceWith")}
          value={replaceTerm}
          onChange={(e) => setReplaceTerm(e.target.value)}
          onKeyDown={handleReplaceKeyDown}
          className="h-7 w-56 rounded border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <IconButton onClick={replaceCurrent} disabled={!hasMatches} title={t("editor.replace")}>
          <Replace className="h-4 w-4" />
        </IconButton>
        <IconButton onClick={replaceAll} disabled={!hasMatches} title={t("editor.replaceAll")}>
          <ReplaceAll className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}
