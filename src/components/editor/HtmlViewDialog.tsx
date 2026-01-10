import { useState, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { useTranslation } from "react-i18next";

interface HtmlViewDialogProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
}

export function HtmlViewDialog({ editor, isOpen, onClose }: HtmlViewDialogProps) {
  const { t } = useTranslation();
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      // Format the HTML with basic indentation
      const rawHtml = editor.getHTML();
      setHtml(formatHtml(rawHtml));
      setError("");
    }
  }, [isOpen, editor]);

  const formatHtml = (html: string): string => {
    // Basic HTML formatting for readability
    let formatted = html;
    const tags = ["<p>", "</p>", "<h1>", "</h1>", "<h2>", "</h2>", "<h3>", "</h3>",
      "<ul>", "</ul>", "<ol>", "</ol>", "<li>", "</li>",
      "<blockquote>", "</blockquote>", "<table>", "</table>",
      "<tr>", "</tr>", "<td>", "</td>", "<th>", "</th>",
      "<thead>", "</thead>", "<tbody>", "</tbody>",
      "<hr>", "<br>", "<div>", "</div>"];

    tags.forEach(tag => {
      formatted = formatted.split(tag).join("\n" + tag);
    });

    // Remove empty lines and trim
    return formatted
      .split("\n")
      .map(line => line.trim())
      .filter(line => line)
      .join("\n");
  };

  const handleApply = () => {
    try {
      editor.commands.setContent(html);
      handleClose();
    } catch (e) {
      setError(t("editor.invalidHtml"));
    }
  };

  const handleClose = () => {
    setHtml("");
    setError("");
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("editor.viewEditHtml")}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleApply}>{t("editor.applyChanges")}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("editor.htmlEditWarning")}
        </p>

        <div>
          <textarea
            value={html}
            onChange={(e) => {
              setHtml(e.target.value);
              setError("");
            }}
            rows={16}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            spellCheck={false}
          />
          {error && <p className="text-sm text-destructive mt-1">{error}</p>}
        </div>
      </div>
    </Modal>
  );
}
