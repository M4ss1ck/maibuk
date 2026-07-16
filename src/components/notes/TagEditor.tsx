import { useTranslation } from "react-i18next";
import { MultiSelectCombobox } from "@/components/ui/MultiSelectCombobox";
import { tagColor } from "@/components/notes/tagColor";

interface TagEditorProps {
  tags: string[];
  allTags: string[];
  onChange: (tags: string[]) => void;
  onClose?: () => void;
}

export function TagEditor({ tags, allTags, onChange, onClose }: TagEditorProps) {
  const { t } = useTranslation();

  return (
    <MultiSelectCombobox
      value={tags}
      onChange={onChange}
      options={allTags}
      placeholder={t("notes.addTag")}
      allowCustom
      customOptionLabel={(tag) => `"${tag}"`}
      removeLabel={(tag) => t("notes.removeTag", { tag })}
      chipClassName="transition-opacity hover:opacity-75 border"
      getChipStyle={(tag) => ({
        color: tagColor(tag),
        backgroundColor: `${tagColor(tag)}26`,
        borderColor: `${tagColor(tag)}80`,
      })}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose?.();
      }}
      className="w-64"
      autoFocus
    />
  );
}
