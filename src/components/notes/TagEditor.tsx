import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MultiSelectCombobox } from "../ui/MultiSelectCombobox";
import { tagColor } from "./tagColor";

interface TagEditorProps {
  tags: string[];
  allTags: string[];
  onChange: (tags: string[]) => void;
  onClose?: () => void;
}

export function TagEditor({ tags, allTags, onChange, onClose }: TagEditorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const removeTag = (tag: string) => {
    onChange(tags.filter((current) => current !== tag));
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
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
        <MultiSelectCombobox
          value={tags}
          onChange={onChange}
          options={allTags}
          placeholder={t("notes.addTag")}
          allowCustom
          customOptionLabel={(tag) => `"${tag}"`}
          removeLabel={(tag) => t("notes.removeTag", { tag })}
          chipClassName="transition-opacity hover:opacity-75"
          getChipStyle={(tag) => ({ backgroundColor: `${tagColor(tag)}22` })}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setOpen(false);
              onClose?.();
            }
          }}
          className="w-64"
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
