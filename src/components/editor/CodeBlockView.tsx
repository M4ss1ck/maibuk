import { useState, useCallback, useRef } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";

export function CodeBlockView({ node }: NodeViewProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  return (
    <NodeViewWrapper as="div" className="code-block-wrapper">
      <button
        type="button"
        className="code-block-copy"
        onClick={handleCopy}
        onMouseDown={(e) => e.preventDefault()}
        contentEditable={false}
        title={copied ? t("editor.copied") : t("editor.copyCode")}
        aria-label={copied ? t("editor.copied") : t("editor.copyCode")}
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      </button>
      <pre>
        <NodeViewContent<"code"> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}
