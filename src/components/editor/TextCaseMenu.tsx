import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { CaseSensitive, CaseUpper, CaseLower, ChevronDown } from "lucide-react";
import { ToolbarButton } from "./ToolbarButton";

interface TextCaseMenuProps {
  editor: Editor;
}

export function TextCaseMenu({ editor }: TextCaseMenuProps) {
  const { t } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const getSelectedText = (): string => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, "");
  };

  const transformSelectedText = (transformer: (text: string) => string) => {
    const { from, to } = editor.state.selection;
    const text = getSelectedText();
    if (text) {
      editor.chain().focus().deleteRange({ from, to }).insertContent(transformer(text)).run();
    }
  };

  const toUpperCase = () => transformSelectedText((text) => text.toUpperCase());
  const toLowerCase = () => transformSelectedText((text) => text.toLowerCase());
  const toAlternatingCase = () => transformSelectedText((text) =>
    text.split("").map((char, i) => i % 2 === 0 ? char.toLowerCase() : char.toUpperCase()).join("")
  );
  const toSentenceCase = () => transformSelectedText((text) =>
    text.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g, (c) => c.toUpperCase())
  );
  const toTitleCase = () => transformSelectedText((text) =>
    text.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  );

  const handleShowMenu = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
    setShowMenu(true);
  };

  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node) &&
        !(e.target instanceof HTMLElement && e.target.closest('.text-case-menu-portal'))
      ) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  return (
    <>
      <ToolbarButton onClick={toUpperCase} title={t("editor.uppercase")}>
        <CaseUpper className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton onClick={toLowerCase} title={t("editor.lowercase")}>
        <CaseLower className="w-4 h-4" />
      </ToolbarButton>

      <button
        ref={buttonRef}
        onClick={() => showMenu ? setShowMenu(false) : handleShowMenu()}
        title={t("editor.textCase")}
        className={`p-2 rounded transition-colors flex items-center gap-0.5 ${showMenu ? "bg-primary text-white" : "hover:bg-muted"}`}
      >
        <CaseSensitive className="w-4 h-4" />
        <ChevronDown className="w-3 h-3" />
      </button>

      {showMenu && createPortal(
        <div
          className="text-case-menu-portal fixed bg-card border border-border rounded-lg shadow-lg py-1 z-50 max-w-min"
          style={{ top: menuPosition.top, left: menuPosition.left }}
        >
          <button
            onClick={() => { toAlternatingCase(); setShowMenu(false); }}
            className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted transition-colors whitespace-nowrap"
          >
            {t("editor.alternatingCase")}
          </button>
          <button
            onClick={() => { toSentenceCase(); setShowMenu(false); }}
            className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted transition-colors whitespace-nowrap"
          >
            {t("editor.sentenceCase")}
          </button>
          <button
            onClick={() => { toTitleCase(); setShowMenu(false); }}
            className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted transition-colors whitespace-nowrap"
          >
            {t("editor.titleCase")}
          </button>
        </div>,
        document.body
      )}
    </>
  );
}
