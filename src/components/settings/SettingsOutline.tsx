import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button as AriaButton,
  Input as AriaInput,
  SearchField,
  Tree,
  TreeItem,
  TreeItemContent,
  type Key,
} from "react-aria-components";
import { ChevronRight, Search, X } from "lucide-react";
import { SETTINGS_SECTIONS, type SettingsRowId } from "@/components/settings/settings-sections";
import type { SettingsSectionId } from "@/components/settings/SettingsSection";
import { buildOutline, type OutlineSelection } from "@/features/settings/outline";
import { currentSettingsPlatform } from "@/features/settings/rows";
import {
  OUTLINE_EASING,
  OUTLINE_MOTION_MS,
  useOutlineMotion,
} from "@/components/settings/useOutlineMotion";

interface SettingsOutlineProps {
  present: readonly SettingsSectionId[];
  selection: OutlineSelection;
  onJump: (section: SettingsSectionId, row: SettingsRowId | null) => void;
}

const sectionKey = (id: string) => `section:${id}`;
const rowKey = (section: string, row: string) => `row:${section}:${row}`;

/**
 * The Settings outline beside the sections: a search field and a tree of
 * sections, the current one listing its rows. It has no backdrop; the ASCII
 * field holds its cursor effect off around it (`data-ascii-quiet`).
 */
export function SettingsOutline({ present, selection, onJump }: SettingsOutlineProps) {
  const { t } = useTranslation();
  const translate = t as unknown as (key: string) => string;
  const [query, setQuery] = useState("");
  // Sections the author opened from the keyboard (Right arrow). They close
  // again when the current section changes, so the tree follows the page.
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setOpened(new Set()), [selection.section]);

  const outline = useMemo(
    () =>
      buildOutline(SETTINGS_SECTIONS, {
        present,
        platform: currentSettingsPlatform(),
        translate,
        query,
        openSection: selection.section,
      }),
    [present, translate, query, selection.section]
  );

  const expandedKeys = useMemo(
    () =>
      new Set(
        outline
          .filter((section) => section.open || opened.has(section.id))
          .map((section) => sectionKey(section.id))
      ),
    [outline, opened]
  );

  const scrollerRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLDivElement>(null);
  const ghostsRef = useRef<HTMLDivElement>(null);
  const currentKey = selection.section ? sectionKey(selection.section) : null;
  useOutlineMotion({
    scrollerRef,
    markerRef,
    ghostsRef,
    currentKey,
    visibleKey:
      selection.section && selection.row ? rowKey(selection.section, selection.row) : currentKey,
    query,
  });

  const onExpandedChange = (keys: Set<Key>) => {
    if (query) return;
    const next = new Set<string>();
    for (const key of keys) {
      const id = String(key).slice("section:".length);
      if (id !== selection.section) next.add(id);
    }
    setOpened(next);
  };

  const onAction = (key: Key) => {
    const [kind, section, row] = String(key).split(":");
    onJump(section as SettingsSectionId, kind === "row" ? (row as SettingsRowId) : null);
  };

  return (
    <nav
      aria-label={t("settings.outline.label")}
      data-ascii-quiet
      data-settings-navigation
      className="hidden @min-[58rem]:flex flex-col sticky top-8 mt-8 mx-auto w-64 shrink-0 max-h-[calc(100vh-4rem)]"
    >
      <SearchField
        aria-label={t("settings.outline.searchLabel")}
        value={query}
        onChange={setQuery}
        className="group flex items-center gap-2 border-b border-border pb-1.5 focus-within:border-primary"
      >
        <Search className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <AriaInput
          placeholder={t("settings.outline.searchPlaceholder")}
          className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        <AriaButton
          aria-label={t("settings.outline.clearSearch")}
          className="text-muted-foreground hover:text-foreground group-data-[empty]:hidden rounded outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-primary"
        >
          <X className="w-4 h-4" />
        </AriaButton>
      </SearchField>

      {outline.length === 0 ? (
        <p role="status" className="mt-4 pl-3 text-sm text-muted-foreground">
          {t("settings.outline.noMatches")}
        </p>
      ) : (
        // The scroll box is the entries' offset parent: the marker and the
        // ghosts of closing rows share their coordinates.
        <div
          ref={scrollerRef}
          className="relative mt-4 min-h-0 overflow-auto scrollbar-themed border-l border-border"
        >
          <div
            ref={markerRef}
            aria-hidden="true"
            data-outline-marker
            className="pointer-events-none absolute top-0 -left-px w-0.5 bg-primary opacity-0 transition-[transform,height,opacity] motion-reduce:transition-none"
            style={{
              transitionDuration: `${OUTLINE_MOTION_MS}ms`,
              transitionTimingFunction: OUTLINE_EASING,
            }}
          />
          <div
            ref={ghostsRef}
            aria-hidden="true"
            inert
            className="pointer-events-none absolute inset-0"
          />
          <Tree
            aria-label={t("settings.outline.label")}
            expandedKeys={expandedKeys}
            onExpandedChange={onExpandedChange}
            onAction={onAction}
            className="outline-none"
          >
            {outline.map((section) => {
              const isCurrent = section.id === selection.section;
              return (
                <TreeItem
                  key={section.id}
                  id={sectionKey(section.id)}
                  textValue={section.label}
                  aria-label={
                    isCurrent && !selection.row
                      ? `${section.label}, ${t("settings.outline.current")}`
                      : section.label
                  }
                  className={({ isFocusVisible }) =>
                    `-ml-px block cursor-pointer border-l-2 border-transparent py-1 pl-3 pr-2 text-sm outline-none transition-colors ${
                      isCurrent
                        ? "text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    } ${isFocusVisible ? "ring-2 ring-inset ring-primary rounded-sm" : ""}`
                  }
                >
                  <TreeItemContent>
                    {({ isExpanded }) => (
                      <span className="flex items-center gap-1">
                        <span className="min-w-0 flex-1 truncate">{section.label}</span>
                        {/* React Aria's expand button: the one way a screen reader
                          user opens or closes a section's rows. Out of the Tab
                          order; ArrowRight/ArrowLeft do the same from the row. */}
                        <AriaButton
                          slot="chevron"
                          className="shrink-0 rounded p-0.5 text-muted-foreground/70 outline-none hover:text-foreground"
                        >
                          <ChevronRight
                            aria-hidden="true"
                            className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                          />
                        </AriaButton>
                      </span>
                    )}
                  </TreeItemContent>
                  {section.rows.map((row) => {
                    const rowCurrent = isCurrent && row.id === selection.row;
                    return (
                      <TreeItem
                        key={row.id}
                        id={rowKey(section.id, row.id)}
                        textValue={row.label}
                        aria-label={
                          rowCurrent ? `${row.label}, ${t("settings.outline.current")}` : row.label
                        }
                        className={({ isFocusVisible }) =>
                          `block cursor-pointer truncate py-0.5 pl-6 pr-2 text-xs outline-none transition-colors ${
                            rowCurrent
                              ? "text-primary font-medium"
                              : "text-muted-foreground hover:text-foreground"
                          } ${isFocusVisible ? "ring-2 ring-inset ring-primary rounded-sm" : ""}`
                        }
                      >
                        <TreeItemContent>
                          <span title={row.label}>{row.label}</span>
                        </TreeItemContent>
                      </TreeItem>
                    );
                  })}
                </TreeItem>
              );
            })}
          </Tree>
        </div>
      )}
    </nav>
  );
}
