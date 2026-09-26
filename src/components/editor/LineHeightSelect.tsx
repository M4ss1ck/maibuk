import type { Editor } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { Combobox } from "@/components/ui";
import {
  DEFAULT_LINE_HEIGHT,
  normalizeLineHeight,
} from "@/components/editor/extensions/LineHeight";

const LINE_HEIGHT_OPTIONS = ["1", "1.15", "1.5", "1.75", "2", "2.5", "3"];

interface LineHeightSelectProps {
  editor: Editor;
  value: string;
}

export function LineHeightSelect({ editor, value }: LineHeightSelectProps) {
  const { t } = useTranslation();

  const handleChange = (lineHeight: string) => {
    const cleanValue = normalizeLineHeight(lineHeight);
    if (cleanValue === null) {
      return;
    }
    if (cleanValue === DEFAULT_LINE_HEIGHT) {
      editor.chain().focus().unsetLineHeight().run();
      return;
    }
    editor.chain().focus().setLineHeight(cleanValue).run();
  };

  return (
    <Combobox
      value={value}
      onChange={handleChange}
      options={LINE_HEIGHT_OPTIONS}
      placeholder={t("editor.lineHeight")}
      ariaLabel={t("editor.lineHeight")}
    />
  );
}
