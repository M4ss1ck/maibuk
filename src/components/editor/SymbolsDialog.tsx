import {
  type KeyboardEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { GridLayout, ListBox, ListBoxItem, Size, Virtualizer } from "react-aria-components";
import type { Editor } from "@tiptap/react";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Tooltip } from "@/components/ui/Tooltip";
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
const MAX_SYMBOL_RESULTS = 500;

interface SymbolsDialogProps {
  editor: Editor;
  isOpen: boolean;
  onClose: () => void;
}

function symbolTooltip(entry: SymbolEntry): string {
  return entry.code ? `${entry.label} \u00b7 ${entry.code}` : entry.label;
}

function titleCaseCategory(label: string, locale: string): string {
  return label.replace(
    /(^|[\s&/-])(\p{L})/gu,
    (_, separator: string, letter: string) => `${separator}${letter.toLocaleUpperCase(locale)}`
  );
}

export function SymbolsDialog({ editor, isOpen, onClose }: SymbolsDialogProps) {
  const { t, i18n } = useTranslation();
  const [catalog, setCatalog] = useState<SymbolsCatalog | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL);
  const [focusedEntry, setFocusedEntry] = useState<SymbolEntry | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const recentListRef = useRef<HTMLDivElement>(null);
  const resultListRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(isOpen);
  const deferredQuery = useDeferredValue(query);
  const recentGlyphs = useSymbolsStore((state) => state.recentGlyphs);
  const addRecentGlyph = useSymbolsStore((state) => state.addRecentGlyph);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (wasOpen && !isOpen) editor.chain().focus().run();
  }, [editor, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoadError(false);
    loadSymbolsCatalog(i18n.language)
      .then((loaded) => {
        if (!cancelled) setCatalog(loaded);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, i18n.language]);

  const pool = useMemo(() => {
    if (!catalog) return [];
    const activeCategory = category === ALL ? null : category;
    return entriesForCategory(catalog, activeCategory);
  }, [catalog, category]);

  const { results, hasMoreResults } = useMemo(() => {
    if (!catalog) return { results: [], hasMoreResults: false };
    const matches = searchSymbols(pool, deferredQuery, null, MAX_SYMBOL_RESULTS + 1);
    const q = deferredQuery.trim();
    if (HEX_QUERY.test(q) && matches.length === 0) {
      const found = lookupByCodePoint(catalog, Number.parseInt(q.replace(/^u\+/i, ""), 16));
      if (found) return { results: [found], hasMoreResults: false };
    }
    return {
      results: matches.slice(0, MAX_SYMBOL_RESULTS),
      hasMoreResults: matches.length > MAX_SYMBOL_RESULTS,
    };
  }, [catalog, pool, deferredQuery]);

  const entryByGlyph = useMemo(() => {
    const map = new Map<string, SymbolEntry>();
    if (catalog) for (const e of catalog.entries) map.set(e.glyph, e);
    return map;
  }, [catalog]);

  const resolveGlyph = (glyph: string): SymbolEntry | null =>
    entryByGlyph.get(glyph) ??
    (catalog && [...glyph].length === 1
      ? lookupByCodePoint(catalog, glyph.codePointAt(0) as number)
      : null);

  const insert = (entry: SymbolEntry) => {
    editor.chain().focus().insertContent(entry.glyph).run();
    addRecentGlyph(entry.glyph);
  };

  const focusOption = (list: HTMLDivElement | null, index = 0) => {
    const options = list?.querySelectorAll<HTMLElement>("[role=option]");
    options?.[Math.min(index, options.length - 1)]?.focus();
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" || results.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    focusOption(resultListRef.current);
  };

  const handleRecentKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      searchRef.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" || results.length === 0) return;

    event.preventDefault();
    event.stopPropagation();
    const options = recentListRef.current?.querySelectorAll<HTMLElement>("[role=option]");
    const index = options ? [...options].indexOf(document.activeElement as HTMLElement) : 0;
    focusOption(resultListRef.current, Math.max(index, 0));
  };

  const handleResultKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowUp") return;
    const options = resultListRef.current?.querySelectorAll<HTMLElement>("[role=option]");
    const index = options ? [...options].indexOf(document.activeElement as HTMLElement) : -1;
    const columnCount = Math.max(
      1,
      Math.floor((resultListRef.current?.clientWidth ?? 0) / 40)
    );
    if (index < 0 || index >= columnCount) return;

    event.preventDefault();
    event.stopPropagation();
    if (recentGlyphs.length > 0) {
      focusOption(recentListRef.current, Math.min(index, recentGlyphs.length - 1));
    } else {
      searchRef.current?.focus();
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as Node;
    if (target === searchRef.current) {
      handleSearchKeyDown(event);
    } else if (recentListRef.current?.contains(target)) {
      handleRecentKeyDown(event);
    } else if (resultListRef.current?.contains(target)) {
      handleResultKeyDown(event);
    }
  };

  const categoryOptions = useMemo(
    () => [
      {
        value: ALL,
        label: titleCaseCategory(t("symbols.allCategories"), i18n.language),
      },
      ...(catalog?.categories.map((value) => ({
        value,
        label: titleCaseCategory(value, i18n.language),
      })) ?? []),
    ],
    [catalog, i18n.language, t]
  );
  const selectedCategoryLabel =
    categoryOptions.find((option) => option.value === category)?.label ?? category;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("symbols.title")}
      size="wide"
      footer={
        <span
          role="status"
          className="block min-h-5 w-full truncate text-sm text-muted-foreground"
        >
          {focusedEntry
            ? `${focusedEntry.label}${focusedEntry.code ? ` \u00b7 ${focusedEntry.code}` : ""}`
            : "\u00a0"}
        </span>
      }
    >
      {!catalog ? (
        <p className="text-sm text-muted-foreground">
          {loadError ? t("symbols.loadError") : t("symbols.loading")}
        </p>
      ) : (
        <div className="flex flex-col gap-3 h-[60vh]" onKeyDownCapture={handleDialogKeyDown}>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <Input
                ref={searchRef}
                type="search"
                role="searchbox"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("symbols.searchPlaceholder")}
                aria-label={t("symbols.searchLabel")}
                className="h-10 text-sm"
              />
            </div>
            <Tooltip content={selectedCategoryLabel} side="bottom">
              <div className="w-72 max-w-[55%] shrink-0">
                <Select
                  value={category}
                  onChange={setCategory}
                  options={categoryOptions}
                  ariaLabel={t("symbols.category")}
                  className="w-full [&>button]:h-10"
                />
              </div>
            </Tooltip>
          </div>
          {recentGlyphs.length > 0 && (
            <ListBox
              ref={recentListRef}
              aria-label={t("symbols.recent")}
              layout="grid"
              orientation="horizontal"
              className="flex flex-wrap gap-1 shrink-0"
            >
              {recentGlyphs.map((glyph) => {
                const entry = resolveGlyph(glyph);
                return (
                  <ListBoxItem
                    key={glyph}
                    id={glyph}
                    textValue={entry?.label ?? glyph}
                    aria-label={entry?.label ?? glyph}
                    onAction={() => {
                      if (entry) insert(entry);
                    }}
                    onFocus={() => setFocusedEntry(entry)}
                    className="w-9 h-9 flex items-center justify-center text-lg rounded border border-border data-[focus-visible]:ring-2 data-[focus-visible]:ring-primary hover:bg-muted cursor-pointer"
                  >
                    {entry ? (
                      <Tooltip content={symbolTooltip(entry)} side="bottom">
                        <span className="flex h-full w-full items-center justify-center">
                          {glyph}
                        </span>
                      </Tooltip>
                    ) : (
                      glyph
                    )}
                  </ListBoxItem>
                );
              })}
            </ListBox>
          )}
          {hasMoreResults && (
            <p className="text-xs text-muted-foreground shrink-0">
              {t("symbols.resultLimit", { count: MAX_SYMBOL_RESULTS })}
            </p>
          )}
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("symbols.noResults")}</p>
          ) : (
            <Virtualizer layout={GridLayout} layoutOptions={{ minItemSize: new Size(40, 40) }}>
              <ListBox
                ref={resultListRef}
                aria-label={t("symbols.grid")}
                layout="grid"
                items={results}
                className="flex-1 overflow-auto outline-none"
              >
                {(entry: SymbolEntry) => (
                  <ListBoxItem
                    id={entry.glyph}
                    textValue={entry.label}
                    aria-label={entry.label}
                    onAction={() => insert(entry)}
                    onFocus={() => setFocusedEntry(entry)}
                    className="flex items-center justify-center text-lg rounded data-[focus-visible]:ring-2 data-[focus-visible]:ring-primary hover:bg-muted cursor-pointer"
                  >
                    <Tooltip content={symbolTooltip(entry)} side="bottom">
                      <span className="flex h-full w-full items-center justify-center">
                        {entry.glyph}
                      </span>
                    </Tooltip>
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
