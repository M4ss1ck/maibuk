import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

interface TagEditorProps {
  tags: string[];
  allTags: string[];
  onChange(tags: string[]): void;
  onClose?: () => void;
}

export function TagEditor({ tags, allTags, onChange, onClose }: TagEditorProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (event.target instanceof Node && !containerRef.current.contains(event.target)) {
        onClose?.();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const filteredTags = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return allTags;
    return allTags.filter((tag) => tag.toLowerCase().includes(normalized));
  }, [allTags, query]);

  const trimmedQuery = query.trim();
  const existingMatch = allTags.find((tag) => tag.toLowerCase() === trimmedQuery.toLowerCase());
  const canCreate = trimmedQuery.length > 0 && !existingMatch;

  const toggleTag = (tag: string) => {
    if (tags.includes(tag)) {
      onChange(tags.filter((t) => t !== tag));
      return;
    }
    onChange([...tags, tag]);
  };

  const createTag = () => {
    if (!canCreate) return;
    onChange([...tags, trimmedQuery]);
    setQuery("");
  };

  return (
    <div
      ref={containerRef}
      className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-border bg-card p-2 shadow-lg"
    >
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("notes.tags")}
        className="mb-2 w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
      />

      <div className="max-h-48 overflow-auto">
        {filteredTags.map((tag) => {
          const selected = tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm text-foreground hover:bg-muted"
            >
              <span>{tag}</span>
              {selected && <Check className="h-3.5 w-3.5 text-primary" />}
            </button>
          );
        })}

        {canCreate && (
          <button
            type="button"
            onClick={createTag}
            className="mt-1 w-full rounded px-2 py-1 text-left text-sm text-primary hover:bg-primary/10"
          >
            {t("notes.createTag", { name: trimmedQuery })}
          </button>
        )}
      </div>
    </div>
  );
}
