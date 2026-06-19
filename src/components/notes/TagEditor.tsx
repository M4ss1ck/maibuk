import type { FocusEvent } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "../ui/Combobox";
import { tagColor } from "./tagColor";

interface TagEditorProps {
  tags: string[];
  allTags: string[];
  onChange: (tags: string[]) => void;
}

export function TagEditor({ tags, allTags, onChange }: TagEditorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const available = allTags.filter((tag) => !tags.includes(tag));

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setOpen(false);
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((current) => current !== tag));
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1" onBlur={handleBlur}>
      {!open &&
        tags.map((tag) => {
          const color = tagColor(tag);

          return (
            <button
              key={tag}
              type="button"
              onClick={() => removeTag(tag)}
              className="rounded-full px-2 py-0.5 text-xs text-foreground transition-opacity hover:opacity-75"
              style={{ backgroundColor: `${color}22` }}
              title={tag}
            >
              {tag}
            </button>
          );
        })}

      {open ? (
        <Combobox
          value=""
          onChange={addTag}
          options={available}
          placeholder={t("notes.addTag")}
          inputClasses="w-40"
          autoFocus
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
        >
          + {t("common.add")}
        </button>
      )}
    </div>
  );
}
