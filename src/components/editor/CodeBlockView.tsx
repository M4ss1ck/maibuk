import { useState, useCallback, useEffect, useRef } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { Tooltip } from "@/components/ui";

export function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [isEditingLanguage, setIsEditingLanguage] = useState(false);
  const [languageDraft, setLanguageDraft] = useState("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const languageInputRef = useRef<HTMLInputElement | null>(null);
  const language = typeof node.attrs.language === "string" ? node.attrs.language : "";

  useEffect(() => {
    setLanguageDraft(language);
  }, [language]);

  useEffect(() => {
    if (!isEditingLanguage) return;
    languageInputRef.current?.focus();
    languageInputRef.current?.select();
  }, [isEditingLanguage]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — nothing we can do
    }
  }, [node.textContent]);

  const saveLanguage = useCallback(() => {
    const nextLanguage = languageDraft
      .trim()
      .toLowerCase()
      .replace(/^language-/, "");
    updateAttributes({ language: nextLanguage || null });
    setIsEditingLanguage(false);
  }, [languageDraft, updateAttributes]);

  const cancelLanguageEdit = useCallback(() => {
    setLanguageDraft(language);
    setIsEditingLanguage(false);
  }, [language]);

  return (
    <NodeViewWrapper as="div" className="code-block-wrapper">
      {isEditingLanguage ? (
        <input
          ref={languageInputRef}
          className="code-block-language-input"
          value={languageDraft}
          onChange={(e) => setLanguageDraft(e.target.value)}
          onBlur={saveLanguage}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              saveLanguage();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancelLanguageEdit();
            }
          }}
          aria-label={t("editor.codeBlockLanguage")}
          contentEditable={false}
        />
      ) : (
        <Tooltip content={t("editor.editCodeBlockLanguage")}>
          <button
            type="button"
            className="code-block-language"
            onClick={() => setIsEditingLanguage(true)}
            onMouseDown={(e) => e.preventDefault()}
            contentEditable={false}
            aria-label={t("editor.editCodeBlockLanguage")}
          >
            {language || t("editor.codeBlockNoLanguage")}
          </button>
        </Tooltip>
      )}
      <Tooltip content={copied ? t("editor.copied") : t("editor.copyCode")}>
        <button
          type="button"
          className="code-block-copy"
          onClick={handleCopy}
          onMouseDown={(e) => e.preventDefault()}
          contentEditable={false}
          aria-label={copied ? t("editor.copied") : t("editor.copyCode")}
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
      </Tooltip>
      <pre>
        <NodeViewContent<"code"> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}
