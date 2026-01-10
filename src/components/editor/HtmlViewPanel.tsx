import { useState, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { Button } from "../ui/Button";
import { useTranslation } from "react-i18next";
import { RefreshIcon, ChevronDownIcon, XIcon } from "../icons";

interface HtmlViewPanelProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
}

export function HtmlViewPanel({ editor, isOpen, onClose }: HtmlViewPanelProps) {
  const { t } = useTranslation();
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const rawHtml = editor.getHTML();
      setHtml(formatHtml(rawHtml));
      setError("");
      setIsDirty(false);
    }
  }, [isOpen, editor]);

  const formatHtml = (html: string): string => {
    let formatted = html;
    const tags = [
      "<p>", "</p>", "<h1>", "</h1>", "<h2>", "</h2>", "<h3>", "</h3>",
      "<ul>", "</ul>", "<ol>", "</ol>", "<li>", "</li>",
      "<blockquote>", "</blockquote>", "<table>", "</table>",
      "<tr>", "</tr>", "<td>", "</td>", "<th>", "</th>",
      "<thead>", "</thead>", "<tbody>", "</tbody>",
      "<hr>", "<br>", "<div>", "</div>"
    ];

    tags.forEach(tag => {
      formatted = formatted.split(tag).join("\n" + tag);
    });

    return formatted
      .split("\n")
      .map(line => line.trim())
      .filter(line => line)
      .join("\n");
  };

  const handleApply = () => {
    try {
      editor.commands.setContent(html);
      setError("");
      setIsDirty(false);
    } catch (e) {
      setError(t("editor.invalidHtml"));
    }
  };

  const handleChange = (value: string) => {
    setHtml(value);
    setIsDirty(true);
    setError("");
  };

  const handleRefresh = () => {
    const rawHtml = editor.getHTML();
    setHtml(formatHtml(rawHtml));
    setIsDirty(false);
    setError("");
  };

  if (!isOpen) return null;

  return (
    <div className="border-t border-border bg-muted/30">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background">
        <div className="flex items-center gap-2">
          <ChevronDownIcon className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t("editor.htmlSource")}</span>
          {isDirty && (
            <span className="text-xs text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded">
              {t("editor.modified")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={handleRefresh} title={t("editor.refreshFromEditor")}>
            <RefreshIcon className="w-4 h-4" />
          </Button>
          {isDirty && (
            <Button size="sm" onClick={handleApply}>
              {t("editor.apply")}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            <XIcon className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="p-2">
        <textarea
          value={html}
          onChange={(e) => handleChange(e.target.value)}
          rows={12}
          className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground font-mono text-xs resize-y focus:outline-none focus:ring-2 focus:ring-primary"
          spellCheck={false}
          placeholder={t("editor.htmlContent")}
        />
        {error && (
          <p className="text-sm text-destructive mt-1">{error}</p>
        )}
      </div>
    </div>
  );
}
