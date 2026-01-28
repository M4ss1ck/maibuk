import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Combobox } from "../ui";

const FONT_FAMILY_OPTIONS = [
  "Literata, serif",
  "Inter, sans-serif",
  "monospace",
  "divider",
  "DejaVu Sans, sans-serif",
  "Ubuntu, sans-serif",
  "Arial, sans-serif",
  "Georgia, serif",
  "Courier New, monospace",
  "Verdana, sans-serif",
  "Times New Roman, serif",
  "Trebuchet MS, sans-serif",
];

interface FontFamilySelectProps {
  editor: Editor;
  value: string;
}

export function FontFamilySelect({ editor, value }: FontFamilySelectProps) {
  const { t } = useTranslation();

  const handleChange = (family: string) => {
    if (family.trim()) {
      editor.chain().focus().setFontFamily(family).run();
    }
  };

  return (
    <Combobox
      value={value}
      onChange={handleChange}
      options={FONT_FAMILY_OPTIONS}
      placeholder={t("editor.fontFamily")}
      inputClasses="w-40"
    />
  );
}
