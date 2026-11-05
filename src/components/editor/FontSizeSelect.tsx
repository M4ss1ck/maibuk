import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Combobox } from "@/components/ui";

const FONT_SIZE_OPTIONS = ["12", "14", "16", "18", "20", "24", "28", "32", "36", "48", "72"];

interface FontSizeSelectProps {
  editor: Editor;
  value: string;
  /** Set only by a floating toolbar: whether this change pulls focus into the text. The Editor Toolbar always does. */
  shouldFocusEditor?: () => boolean;
}

export function FontSizeSelect({ editor, value, shouldFocusEditor }: FontSizeSelectProps) {
  const { t } = useTranslation();
  const chain = () => (shouldFocusEditor?.() === false ? editor.chain() : editor.chain().focus());

  const handleChange = (size: string) => {
    const sizeValue = size.replace(/[^0-9]/g, "");
    if (sizeValue) {
      chain().setFontSize(`${sizeValue}px`).run();
    }
  };

  return (
    <Combobox
      value={value}
      onChange={handleChange}
      options={FONT_SIZE_OPTIONS}
      placeholder={t("editor.size")}
      explicitCommitOnly
      ariaLabel={t("editor.size")}
    />
  );
}
