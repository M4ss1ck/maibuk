import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Combobox } from "@/components/ui";

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
  /** Set only by a floating toolbar: whether this change pulls focus into the text. The Editor Toolbar always does. */
  shouldFocusEditor?: () => boolean;
}

export function FontFamilySelect({ editor, value, shouldFocusEditor }: FontFamilySelectProps) {
  const { t } = useTranslation();
  const chain = () => (shouldFocusEditor?.() === false ? editor.chain() : editor.chain().focus());

  const handleChange = (family: string) => {
    if (family.trim()) {
      chain().setFontFamily(family).run();
    }
  };

  return (
    <Combobox
      value={value}
      onChange={handleChange}
      options={FONT_FAMILY_OPTIONS}
      placeholder={t("editor.fontFamily")}
      explicitCommitOnly
      ariaLabel={t("editor.fontFamily")}
      inputClasses="w-40"
    />
  );
}
