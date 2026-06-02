import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "../ui";

interface TagEditorProps {
  tags: string[];
  allTags: string[];
  onChange(tags: string[]): void;
}

export function TagEditor({ tags, allTags, onChange }: TagEditorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const available = allTags.filter((tag) => !tags.includes(tag));

  const addTag = (tag: string) => {
    setOpen(false);
    const trimmed = tag.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    onChange([...tags, trimmed]);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-muted px-2 py-1 text-xs text-foreground hover:bg-muted"
      >
        + {t("common.add")}
      </button>
    );
  }

  return (
    <Combobox
      value=""
      onChange={addTag}
      options={available}
      placeholder={t("notes.addTag")}
      inputClasses="w-40"
      autoFocus
    />
  );
}
