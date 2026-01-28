import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Combobox } from "../ui";

const LINE_HEIGHT_OPTIONS = ["1", "1.15", "1.5", "2", "2.5", "3"];

interface LineHeightSelectProps {
  editor: Editor;
  value: string;
}

export function LineHeightSelect({ editor, value }: LineHeightSelectProps) {
  const { t } = useTranslation();

  const handleChange = (lineHeight: string) => {
    const cleanValue = lineHeight.replace(/[^0-9.]/g, "");
    if (cleanValue) {
      editor.chain().focus().setLineHeight(cleanValue).run();
    }
  };

  return (
    <Combobox
      value={value}
      onChange={handleChange}
      options={LINE_HEIGHT_OPTIONS}
      placeholder={t("editor.lineHeight")}
    />
  );
}
