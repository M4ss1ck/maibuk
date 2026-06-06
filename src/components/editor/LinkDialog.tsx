import { useState, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useTranslation } from "react-i18next";
import { formatLinkUri, isInternalLink } from "../../features/links/link-uri";

type LinkTextMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

type LinkedTextContent = {
  type: "text";
  text: string;
  marks: LinkTextMark[];
};

export type InternalTarget =
  | {
      type: "note";
      noteId: string;
      title: string;
    }
  | {
      type: "book";
      bookId: string;
      title: string;
    }
  | {
      type: "chapter";
      chapterId: string;
      title: string;
      headingId: null;
    }
  | {
      type: "heading";
      chapterId: string;
      title: string;
      headingId: string;
    };

interface LinkDialogProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
  bookId?: string | null;
  internalTargets?: InternalTarget[];
}

function getSelectedMarks(editor: Editor): LinkTextMark[] {
  const { from, to } = editor.state.selection;
  const doc = editor.state.doc;
  const marks = new Map<string, LinkTextMark>();

  if (from === to || typeof doc.nodesBetween !== "function") {
    return [];
  }

  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      const type = mark.type.name;
      if (type === "link" || marks.has(type)) continue;
      marks.set(type, { type, attrs: mark.attrs });
    }
  });

  return Array.from(marks.values());
}

function createLinkedTextContent(
  editor: Editor,
  href: string,
  displayText: string,
): LinkedTextContent | string {
  const marks = getSelectedMarks(editor);
  if (marks.length === 0) {
    return `<a href="${href}">${displayText}</a>`;
  }

  return {
    type: "text",
    text: displayText,
    marks: [...marks, { type: "link", attrs: { href } }],
  };
}

function getTargetHref(target: InternalTarget): string {
  switch (target.type) {
    case "note":
      return formatLinkUri({ targetType: "note", targetId: target.noteId });
    case "book":
      return formatLinkUri({ targetType: "book", targetId: target.bookId });
    case "chapter":
      return formatLinkUri({ targetType: "chapter", targetId: target.chapterId });
    case "heading":
      return formatLinkUri({
        targetType: "heading",
        targetId: target.chapterId,
        headingId: target.headingId,
      });
  }
}

function getTargetKey(target: InternalTarget): string {
  switch (target.type) {
    case "note":
      return `note-${target.noteId}`;
    case "book":
      return `book-${target.bookId}`;
    case "chapter":
      return `chapter-${target.chapterId}`;
    case "heading":
      return `heading-${target.chapterId}-${target.headingId}`;
  }
}

type TargetTypeLabelKey =
  | "editor.linkTargetNote"
  | "editor.linkTargetBook"
  | "editor.linkTargetChapter"
  | "editor.linkTargetHeading";

function getTargetTypeLabelKey(target: InternalTarget): TargetTypeLabelKey {
  switch (target.type) {
    case "note":
      return "editor.linkTargetNote";
    case "book":
      return "editor.linkTargetBook";
    case "chapter":
      return "editor.linkTargetChapter";
    case "heading":
      return "editor.linkTargetHeading";
  }
}

export function LinkDialog({ editor, isOpen, onClose, bookId, internalTargets = [] }: LinkDialogProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"url" | "internal">("url");
  const [query, setQuery] = useState("");

  // Get current link and selection when dialog opens
  useEffect(() => {
    if (isOpen) {
      const { from, to } = editor.state.selection;
      const selectedText = editor.state.doc.textBetween(from, to);
      const currentLink = editor.getAttributes("link").href || "";

      setText(selectedText);
      setUrl(currentLink);
      setError("");
      setMode(isInternalLink(currentLink) ? "internal" : "url");
      setQuery("");
    }
  }, [isOpen, editor]);

  const handleInsert = () => {
    if (!url.trim()) {
      setError(t("errors.URLRequired"));
      return;
    }

    // Validate URL format
    let finalUrl = url.trim();
    if (
      !isInternalLink(finalUrl) &&
      !/^https?:\/\//i.test(finalUrl) &&
      !finalUrl.startsWith("mailto:")
    ) {
      finalUrl = `https://${finalUrl}`;
    }

    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to);
    const displayText = text.trim();

    if (from === to || !selectedText) {
      // No selection or empty selection — insert text with link
      editor
        .chain()
        .focus()
        .insertContent(`<a href="${finalUrl}">${displayText || finalUrl}</a>`)
        .run();
    } else if (displayText && displayText !== selectedText) {
      // Selection exists and display text was customized — replace with new text
      editor
        .chain()
        .focus()
        .insertContent(createLinkedTextContent(editor, finalUrl, displayText))
        .run();
    } else {
      // Selection exists — just update the link
      editor.chain().focus().setLink({ href: finalUrl }).run();
    }

    handleClose();
  };

  const handleRemove = () => {
    editor.chain().focus().unsetLink().run();
    handleClose();
  };

  const handleClose = () => {
    setUrl("");
    setText("");
    setError("");
    setMode("url");
    setQuery("");
    onClose();
  };

  const handleInsertInternal = (target: InternalTarget) => {
    const href = getTargetHref(target);
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to);
    const displayText = text.trim();

    if (from === to || !selectedText) {
      // No selection or empty selection — insert linked text
      editor
        .chain()
        .focus()
        .insertContent(
          `<a href="${href}">${displayText || target.title}</a>`,
        )
        .run();
    } else if (displayText && displayText !== selectedText) {
      // Selection exists and display text was customized — replace with new text
      editor
        .chain()
        .focus()
        .insertContent(createLinkedTextContent(editor, href, displayText))
        .run();
    } else {
      // Selection exists — just update the link
      editor.chain().focus().setLink({ href }).run();
    }
    handleClose();
  };

  const handleUpdateInternal = () => {
    const href = url.trim();
    if (!isInternalLink(href)) {
      setError(t("errors.URLRequired"));
      return;
    }

    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to);
    const displayText = text.trim();

    if (from === to || !selectedText) {
      editor
        .chain()
        .focus()
        .insertContent(`<a href="${href}">${displayText || href}</a>`)
        .run();
    } else if (displayText && displayText !== selectedText) {
      editor
        .chain()
        .focus()
        .insertContent(createLinkedTextContent(editor, href, displayText))
        .run();
    } else {
      editor.chain().focus().setLink({ href }).run();
    }

    handleClose();
  };

  const filteredTargets = internalTargets.filter((tgt) =>
    tgt.title.toLowerCase().includes(query.toLowerCase()),
  );

  const isEditing = !!editor.getAttributes("link").href;
  const canLinkInternally = !!bookId || internalTargets.length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditing ? t("editor.editLink") : t("editor.insertLink")}
      footer={
        <>
          {isEditing && (
            <Button
              variant="secondary"
              onClick={handleRemove}
              className="text-destructive hover:bg-destructive hover:text-white"
            >
              {t("editor.removeLink")}
            </Button>
          )}
          <Button variant="secondary" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          {mode === "url" && (
            <Button onClick={handleInsert}>
              {isEditing ? t("common.update") : t("common.insert")}
            </Button>
          )}
          {mode === "internal" && isEditing && (
            <Button onClick={handleUpdateInternal}>{t("common.update")}</Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {canLinkInternally && (
          <div className="flex gap-2">
            <Button
              variant={mode === "url" ? "primary" : "secondary"}
              onClick={() => setMode("url")}
            >
              {t("editor.linkExternalUrl")}
            </Button>
            <Button
              variant={mode === "internal" ? "primary" : "secondary"}
              onClick={() => setMode("internal")}
            >
              {t("editor.linkInThisBook")}
            </Button>
          </div>
        )}

        {mode === "url" && (
          <div>
            <label htmlFor="link-url" className="block text-sm font-medium mb-1">
              URL
            </label>
            <Input
              id="link-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError("");
              }}
              placeholder="https://example.com"
              autoFocus
            />
            {error && <p className="text-sm text-destructive mt-1">{error}</p>}
          </div>
        )}

        <div>
          <label htmlFor="link-text" className="block text-sm font-medium mb-1">
            {t("editor.displayText")}{" "}
            <span className="text-muted-foreground">
              {t("editor.optional")}
            </span>
          </label>
          <Input
            id="link-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("editor.linkText")}
          />
          <p className="text-xs text-muted-foreground mt-1">
            {t("editor.leaveEmpty")}
          </p>
        </div>

        {mode === "internal" && (
          <div className="space-y-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("editor.searchTargets")}
              autoFocus
            />
            <ul className="max-h-64 overflow-auto rounded-lg border border-border">
              {filteredTargets.map((tgt) => (
                <li key={getTargetKey(tgt)}>
                  <button
                    type="button"
                    onClick={() => handleInsertInternal(tgt)}
                    className={`w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between gap-3 ${
                      tgt.type === "heading"
                        ? "pl-6 text-sm text-muted-foreground"
                        : "font-medium"
                    }`}
                  >
                    <span className="min-w-0 truncate">{tgt.title}</span>
                    <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t(getTargetTypeLabelKey(tgt))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
