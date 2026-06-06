import { useState, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useTranslation } from "react-i18next";
import { formatLinkUri } from "../../features/links/link-uri";

export interface InternalTarget {
  type: "chapter" | "heading";
  chapterId: string;
  title: string;
  headingId: string | null;
}

interface LinkDialogProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
  bookId?: string | null;
  internalTargets?: InternalTarget[];
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
      setMode("url");
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
    if (!/^https?:\/\//i.test(finalUrl) && !finalUrl.startsWith("mailto:")) {
      finalUrl = `https://${finalUrl}`;
    }

    if (text.trim()) {
      // If we have custom text, insert it with the link
      const { from, to } = editor.state.selection;
      if (from === to) {
        // No selection, insert text with link
        editor
          .chain()
          .focus()
          .insertContent(`<a href="${finalUrl}">${text.trim()}</a>`)
          .run();
      } else {
        // Has selection, set link on selection
        editor.chain().focus().setLink({ href: finalUrl }).run();
      }
    } else {
      // Just set link on current selection
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
    const href =
      target.type === "heading" && target.headingId
        ? formatLinkUri({
            targetType: "heading",
            targetId: target.chapterId,
            headingId: target.headingId,
          })
        : formatLinkUri({ targetType: "chapter", targetId: target.chapterId });
    editor.chain().focus().setLink({ href }).run();
    handleClose();
  };

  const filteredTargets = internalTargets.filter((tgt) =>
    tgt.title.toLowerCase().includes(query.toLowerCase()),
  );

  const isEditing = !!editor.getAttributes("link").href;

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
        </>
      }
    >
      <div className="space-y-4">
        {bookId && (
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
          <>
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
          </>
        )}

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
                <li key={`${tgt.chapterId}-${tgt.headingId ?? "chapter"}`}>
                  <button
                    type="button"
                    onClick={() => handleInsertInternal(tgt)}
                    className={`w-full text-left px-3 py-2 hover:bg-muted ${
                      tgt.type === "heading"
                        ? "pl-6 text-sm text-muted-foreground"
                        : "font-medium"
                    }`}
                  >
                    {tgt.title}
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
