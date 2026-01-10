import { useState, useCallback, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useTranslation } from "react-i18next";
import { CloseIcon, ChevronDownIcon } from "../icons";

interface FindReplaceProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
}

export function FindReplace({ editor, isOpen, onClose }: FindReplaceProps) {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);

  const findMatches = useCallback(() => {
    if (!searchTerm) {
      setMatchCount(0);
      setCurrentMatch(0);
      return [];
    }

    const matches: { from: number; to: number }[] = [];
    const searchLower = searchTerm.toLowerCase();

    editor.state.doc.descendants((node, nodePos) => {
      if (node.isText && node.text) {
        const text = node.text.toLowerCase();
        let offset = 0;
        let matchIndex = text.indexOf(searchLower, offset);

        while (matchIndex !== -1) {
          matches.push({
            from: nodePos + matchIndex,
            to: nodePos + matchIndex + searchTerm.length,
          });
          offset = matchIndex + 1;
          matchIndex = text.indexOf(searchLower, offset);
        }
      }
    });

    setMatchCount(matches.length);
    if (matches.length > 0 && currentMatch === 0) {
      setCurrentMatch(1);
    } else if (matches.length === 0) {
      setCurrentMatch(0);
    }

    return matches;
  }, [editor, searchTerm, currentMatch]);

  const goToMatch = useCallback((matchIndex: number) => {
    const matches = findMatches();
    if (matches.length === 0 || matchIndex < 1 || matchIndex > matches.length) return;

    const match = matches[matchIndex - 1];
    editor.commands.setTextSelection(match);

    // Scroll to selection
    const element = editor.view.domAtPos(match.from);
    if (element.node instanceof Element) {
      element.node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [editor, findMatches]);

  const findNext = useCallback(() => {
    const newMatch = currentMatch < matchCount ? currentMatch + 1 : 1;
    setCurrentMatch(newMatch);
    goToMatch(newMatch);
  }, [currentMatch, matchCount, goToMatch]);

  const findPrev = useCallback(() => {
    const newMatch = currentMatch > 1 ? currentMatch - 1 : matchCount;
    setCurrentMatch(newMatch);
    goToMatch(newMatch);
  }, [currentMatch, matchCount, goToMatch]);

  const replaceOne = useCallback(() => {
    const matches = findMatches();
    if (matches.length === 0 || currentMatch < 1) return;

    const match = matches[currentMatch - 1];
    editor
      .chain()
      .focus()
      .setTextSelection(match)
      .deleteSelection()
      .insertContent(replaceTerm)
      .run();

    // Re-find after replace
    setTimeout(() => {
      const newMatches = findMatches();
      if (currentMatch > newMatches.length) {
        setCurrentMatch(newMatches.length);
      }
    }, 0);
  }, [editor, replaceTerm, currentMatch, findMatches]);

  const replaceAll = useCallback(() => {
    const matches = findMatches();
    if (matches.length === 0) return;

    // Replace from end to start to maintain positions
    const sortedMatches = [...matches].sort((a, b) => b.from - a.from);

    let chain = editor.chain().focus();

    for (const match of sortedMatches) {
      chain = chain
        .setTextSelection(match)
        .deleteSelection()
        .insertContent(replaceTerm);
    }

    chain.run();

    setMatchCount(0);
    setCurrentMatch(0);
  }, [editor, replaceTerm, findMatches]);

  useEffect(() => {
    if (searchTerm) {
      findMatches();
    } else {
      setMatchCount(0);
      setCurrentMatch(0);
    }
  }, [searchTerm, findMatches]);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm("");
      setReplaceTerm("");
      setMatchCount(0);
      setCurrentMatch(0);
    }
  }, [isOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        findNext();
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        findPrev();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, findNext, findPrev]);

  if (!isOpen) return null;

  return (
    <div className="absolute top-14 right-4 bg-card border border-border rounded-lg shadow-lg p-4 z-50 w-80">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-foreground">{t("editor.findReplace")}</h3>
        <button
          onClick={onClose}
          className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <Input
            placeholder={t("editor.find")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
          />
          {searchTerm && (
            <div className="text-xs text-muted-foreground mt-1">
              {matchCount > 0 ? t("editor.matchesOf", { current: currentMatch, total: matchCount }) : t("editor.noMatches")}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={findPrev} disabled={matchCount === 0}>
            <ChevronDownIcon className="w-4 h-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={findNext} disabled={matchCount === 0}>
            <ChevronDownIcon className="w-4 h-4" />
          </Button>
        </div>

        <Input
          placeholder={t("editor.replaceWith")}
          value={replaceTerm}
          onChange={(e) => setReplaceTerm(e.target.value)}
        />

        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={replaceOne} disabled={matchCount === 0}>
            {t("editor.replace")}
          </Button>
          <Button variant="secondary" size="sm" onClick={replaceAll} disabled={matchCount === 0}>
            {t("editor.replaceAll")}
          </Button>
        </div>
      </div>
    </div>
  );
}
