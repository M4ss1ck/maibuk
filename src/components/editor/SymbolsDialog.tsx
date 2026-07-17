import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListBox, ListBoxItem, Size, Virtualizer } from "react-aria-components";
import { GridLayout } from "react-aria-components/Virtualizer";
import type { Editor } from "@tiptap/react";
import type { Key, Selection } from "react-aria-components";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import {
  entriesForCategory,
  loadSymbolsCatalog,
  lookupByCodePoint,
  type SymbolsCatalog,
} from "@/features/symbols/load";
import { searchSymbols } from "@/features/symbols/search";
import { useSymbolsStore } from "@/features/symbols/store";
import type { SymbolEntry } from "@/features/symbols/types";

const ALL = "__all__";
const HEX_QUERY = /^(u\+)?[0-9a-f]{2,6}$/i;

interface SymbolsDialogProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
}

export function SymbolsDialog({ editor, isOpen, onClose }: SymbolsDialogProps) {
  const { t, i18n } = useTranslation();
  const [catalog, setCatalog] = useState<SymbolsCatalog | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL);
  const [focusedEntry, setFocusedEntry] = useState<SymbolEntry | null>(null);
  const recentGlyphs = useSymbolsStore((state) => state.recentGlyphs);
  const addRecentGlyph = useSymbolsStore((state) => state.addRecentGlyph);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    loadSymbolsCatalog(i18n.language).then((loaded) => {
      if (!cancelled) setCatalog(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, i18n.language]);

  const results = useMemo(() => {
    if (!catalog) return [];
    const activeCategory = category === ALL ? null : category;
    const pool = entriesForCategory(catalog, activeCategory);
    const matches = searchSymbols(pool, query, null);
    const q = query.trim();
    if (HEX_QUERY.test(q) && matches.length === 0) {
      const found = lookupByCodePoint(catalog, Number.parseInt(q.replace(/^u\+/i, ""), 16));
      if (found) return [found];
    }
    return matches;
  }, [catalog, query, category]);

  const entryByGlyph = useMemo(() => {
    const map = new Map<string, SymbolEntry>();
    if (catalog) for (const e of catalog.entries) map.set(e.glyph, e);
    return map;
  }, [catalog]);

  const insert = (entry: SymbolEntry) => {
    editor.chain().focus().insertContent(entry.glyph).run();
    addRecentGlyph(entry.glyph);
  };

  const handleGridAction = (key: Key) => {
    const entry = results.find((e) => e.glyph === String(key));
    if (entry) insert(entry);
  };

  const handleSelectionChange = (selection: Selection) => {
    if (selection === "all") return;
    const key = [...selection][0];
    setFocusedEntry(results.find((e) => e.glyph === String(key)) ?? null);
  };

  const categoryOptions = useMemo(
    () => [
      { value: ALL, label: t("symbols.allCategories") },
      ...(catalog?.categories.map((c) => ({ value: c, label: c })) ?? []),
    ],
    [catalog, t]
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("symbols.title")}
      size="wide"
      footer={
        focusedEntry ? (
          <span className="text-sm text-muted-foreground truncate">
            {focusedEntry.label}
            {focusedEntry.code ? ` \u00b7 ${focusedEntry.code}` : ""}
          </span>
        ) : null
      }
    >
      {!catalog ? (
        <p className="text-sm text-muted-foreground">{t("symbols.loading")}</p>
      ) : (
        <div className="flex flex-col gap-3 h-[60vh]">
          <div className="flex gap-2">
            <Input
              type="search"
              role="searchbox"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("symbols.searchPlaceholder")}
              aria-label={t("symbols.searchLabel")}
              className="flex-1"
            />
            <Select
              value={category}
              onChange={setCategory}
              options={categoryOptions}
              ariaLabel={t("symbols.category")}
            />
          </div>
          {recentGlyphs.length > 0 && (
            <ListBox
              aria-label={t("symbols.recent")}
              layout="grid"
              orientation="horizontal"
              className="flex flex-wrap gap-1 shrink-0"
              onAction={(key) => {
                const entry = entryByGlyph.get(String(key));
                if (entry) insert(entry);
              }}
            >
              {recentGlyphs.map((glyph) => {
                const entry = entryByGlyph.get(glyph);
                return (
                  <ListBoxItem
                    key={glyph}
                    id={glyph}
                    textValue={entry?.label ?? glyph}
                    aria-label={entry?.label ?? glyph}
                    className="w-9 h-9 flex items-center justify-center text-lg rounded border border-border data-[focus-visible]:ring-2 data-[focus-visible]:ring-primary hover:bg-muted cursor-pointer"
                  >
                    {glyph}
                  </ListBoxItem>
                );
              })}
            </ListBox>
          )}
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("symbols.noResults")}</p>
          ) : (
            <Virtualizer layout={GridLayout} layoutOptions={{ minItemSize: new Size(40, 40) }}>
              <ListBox
                aria-label={t("symbols.grid")}
                layout="grid"
                selectionMode="single"
                selectionBehavior="replace"
                items={results}
                onAction={handleGridAction}
                onSelectionChange={handleSelectionChange}
                className="flex-1 overflow-auto outline-none"
              >
                {(entry: SymbolEntry) => (
                  <ListBoxItem
                    id={entry.glyph}
                    textValue={entry.label}
                    aria-label={entry.label}
                    className="flex items-center justify-center text-lg rounded data-[focus-visible]:ring-2 data-[focus-visible]:ring-primary data-[selected]:bg-primary/15 hover:bg-muted cursor-pointer"
                  >
                    {entry.glyph}
                  </ListBoxItem>
                )}
              </ListBox>
            </Virtualizer>
          )}
        </div>
      )}
    </Modal>
  );
}
