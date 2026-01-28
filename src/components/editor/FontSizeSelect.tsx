import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Combobox } from "../ui";

const FONT_SIZE_OPTIONS = ["12", "14", "16", "18", "20", "24", "28", "32", "36", "48", "72"];

interface FontSizeSelectProps {
  editor: Editor;
  value: string;
}

export function FontSizeSelect({ editor, value }: FontSizeSelectProps) {
  const { t } = useTranslation();

  const handleChange = (size: string) => {
    const sizeValue = size.replace(/[^0-9]/g, "");
    if (sizeValue) {
      editor.chain().focus().setFontSize(`${sizeValue}px`).run();
    }
  };

  return (
    <Combobox
      value={value}
      onChange={handleChange}
      options={FONT_SIZE_OPTIONS}
      placeholder={t("editor.size")}
    />
  );
}
