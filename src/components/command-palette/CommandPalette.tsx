import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useMatch } from "react-router-dom";
import {
  Autocomplete,
  Header,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  ListLayout,
  SearchField,
  Text,
  Virtualizer,
} from "react-aria-components";
import { NotebookPen, Workflow, X } from "lucide-react";
import { ChapterIcon, ProjectsIcon, SettingsIcon } from "@/components/icons";
import { Modal } from "@/components/ui/Modal";
import { KeyboardShortcut } from "@/components/ui/KeyboardShortcut";
import { toast } from "@/components/ui/Toast";
import { useModalStore } from "@/components/ui/modal-store";
import { useBookStore } from "@/features/books/store";
import { useCanvasStore } from "@/features/canvas/store";
import { listChapterTitles, type ChapterTitle } from "@/features/chapters/store";
import {
  buildCommandItems,
  buildEntityItems,
  buildPageItems,
  buildSettingsItems,
  liveRecentKeys,
  preparePaletteIndex,
  searchPalette,
  useCommandPaletteRecentStore,
  useCommandPaletteStore,
} from "@/features/command-palette";
import type {
  PaletteItem,
  PaletteItemKind,
  PalettePage,
  PaletteResult,
  PaletteTranslate,
} from "@/features/command-palette/palette-index";
import type { SettingsRowId } from "@/components/settings/settings-sections";
import { focusSettingsRow } from "@/features/settings/focus-row";
import { currentSettingsPlatform } from "@/features/settings/rows";
import { useNoteStore } from "@/features/notes/store";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { normalizeLanguage } from "@/features/settings/types";
import { flushPendingEdits } from "@/features/sync/pending-edits";
import { useBoundShortcutIds } from "@/lib/bound-shortcuts";
import { useCommandKeys } from "@/lib/command-keys";
import { commandState, runCommand } from "@/lib/command-runner";
import { isMac } from "@/lib/platform/detect";
import { formatShortcut } from "@/lib/shortcut-keys";
import type { CommandId } from "@/lib/shortcut-registry";

/**
 * The Command Palette dialog: every mounted Command, searchable by label,
 * Voice Command phrase, and keywords, with the device-local Recent first.
 * Mounted once beside GlobalShortcuts (so never on /embed); renders only
 * while open, and the index is prepared once per open, never per keystroke.
 */
export function CommandPalette() {
  const isOpen = useCommandPaletteStore((state) => state.isOpen);
  if (!isOpen) return null;
  return <OpenCommandPalette />;
}

// Padding keeps the last row's focus ring inside the scroll box.
const LIST_LAYOUT_OPTIONS = { estimatedRowSize: 32, estimatedHeadingSize: 22, padding: 4 };

function OpenCommandPalette() {
  const { t, i18n } = useTranslation();
  const close = useCommandPaletteStore((state) => state.close);
  const snapshot = useCommandPaletteStore((state) => state.snapshot);
  const customVoice = useShortcutSettingsStore((state) => state.shortcuts.voice);
  const recentKeys = useCommandPaletteRecentStore((state) => state.keys);
  const recordRecent = useCommandPaletteRecentStore((state) => state.record);
  const removeRecent = useCommandPaletteRecentStore((state) => state.remove);
  const pruneRecent = useCommandPaletteRecentStore((state) => state.prune);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<PalettePage>("root");
  const [announcement, setAnnouncement] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [entities, setEntities] = useState<{
    books: ReturnType<typeof useBookStore.getState>["books"];
    chapters: ChapterTitle[];
    notes: ReturnType<typeof useNoteStore.getState>["notes"];
    canvases: ReturnType<typeof useCanvasStore.getState>["canvases"];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const removalRef = useRef(false);
  const previousCountRef = useRef(-1);
  const mac = isMac();
  const navigate = useNavigate();
  const location = useLocation();
  const openBookId = useMatch("/book/:bookId")?.params.bookId ?? null;

  // One typed local for the builders: they accept registry and Settings keys
  // the i18n `t` type does not know about.
  const translate = t as unknown as PaletteTranslate;

  const commandItems = useMemo(
    () =>
      buildCommandItems({
        snapshot,
        t: translate,
        language: normalizeLanguage(i18n.language),
        customVoice,
      }),
    [snapshot, translate, i18n.language, customVoice]
  );

  // Entities load once per open, in the background: the Commands are listed
  // right away and merge in when the Library answers, so there is no spinner
  // to flash. A store that already holds its list is not re-read.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const bookStore = useBookStore.getState();
      const noteStore = useNoteStore.getState();
      const canvasStore = useCanvasStore.getState();
      const [, , , chapters] = await Promise.all([
        // The refresh reads the Library without flipping the store's isLoading,
        // which would blank the page behind the palette and drop the focus its
        // opener held.
        bookStore.refreshBooks(),
        noteStore.refreshNotes(),
        canvasStore.refreshCanvases(),
        listChapterTitles(),
      ]);
      if (cancelled) return;
      setEntities({
        books: useBookStore.getState().books,
        chapters,
        notes: useNoteStore.getState().notes,
        canvases: useCanvasStore.getState().canvases,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pageItems = useMemo(
    () =>
      buildPageItems({
        t: translate,
        inBookEditor: openBookId !== null,
      }),
    [translate, openBookId]
  );
  const settingsItems = useMemo(
    () =>
      buildSettingsItems({
        t: translate,
        platform: currentSettingsPlatform(),
      }),
    [translate]
  );
  const entityItems = useMemo(
    () =>
      entities
        ? buildEntityItems({
            books: entities.books,
            chapters: entities.chapters,
            notes: entities.notes,
            canvases: entities.canvases,
            t: translate,
          })
        : [],
    [entities, translate]
  );

  const items = useMemo(
    () => [...commandItems, ...pageItems, ...settingsItems, ...entityItems],
    [commandItems, pageItems, settingsItems, entityItems]
  );
  const index = useMemo(() => preparePaletteIndex(items), [items]);

  // Drop Recent entries that resolve to nothing, silently. Only once the
  // entities are in: pruning against a Command-only index would drop a Recent
  // Book just because the Library had not answered yet.
  const entitiesLoaded = entities !== null;
  useEffect(() => {
    if (!entitiesLoaded) return;
    pruneRecent(liveRecentKeys(index, recentKeys));
  }, [entitiesLoaded, index, pruneRecent, recentKeys]);

  const sections = useMemo(
    () => searchPalette(index, { query, page, recent: recentKeys, openBookId }),
    [index, query, page, recentKeys, openBookId]
  );
  const flatResults = useMemo(() => sections.flatMap((section) => section.results), [sections]);
  const count = flatResults.length;
  const recentKeySet = useMemo(() => new Set(recentKeys), [recentKeys]);

  // The count and the removal confirmation share one live region: a removal
  // wins over the count change it causes. A removal may change no count at
  // all (a Suggested row fills the place), so it announces itself.
  useEffect(() => {
    if (previousCountRef.current === count) return;
    previousCountRef.current = count;
    if (removalRef.current) {
      removalRef.current = false;
      return;
    }
    setAnnouncement(t("commandPalette.resultCount", { count }));
  }, [count, t]);

  // Entering or leaving a nested page is announced after the count it changes,
  // so this effect sits below the count's on purpose.
  useEffect(() => {
    if (page === "root") return;
    setAnnouncement(
      t("commandPalette.pageAnnouncement", { page: t(`commandPalette.chips.${page}`) })
    );
  }, [page, t]);

  // The active result lives in React Aria's virtual focus (the caret stays in
  // the field), so read it off the input's active descendant.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const sync = () => {
      const id = input.getAttribute("aria-activedescendant");
      const key = (id ? document.getElementById(id)?.getAttribute("data-key") : null) ?? null;
      setActiveKey((previous) => (previous === key ? previous : key));
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(input, { attributes: true, attributeFilter: ["aria-activedescendant"] });
    return () => observer.disconnect();
  }, []);

  // useShortcuts pauses while this Modal is open, so Shift+Delete is handled
  // on the field itself; the id is still declared for the shortcut help.
  useBoundShortcutIds(
    ["commandPalette.removeRecent"],
    activeKey !== null && recentKeySet.has(activeKey)
  );

  const removeByKey = (key: string) => {
    removalRef.current = true;
    setAnnouncement(t("commandPalette.removedFromRecent"));
    removeRecent(key);
  };

  const changeQuery = (value: string) => {
    // Typing after a removal that changed no count: the next count is news.
    removalRef.current = false;
    setQuery(value);
  };

  const removeActiveRecent = () => {
    if (activeKey === null || !recentKeySet.has(activeKey)) return;
    const inRecent = sections.some(
      (section) =>
        section.id === "recent" && section.results.some((result) => result.item.key === activeKey)
    );
    if (inRecent) removeByKey(activeKey);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // One Escape always closes the palette: the SearchField would otherwise
    // clear a non-empty query on the first press and need a second to close.
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Delete" && event.shiftKey) {
      event.preventDefault();
      removeActiveRecent();
      return;
    }
    // Backspace on an empty field steps out of a nested page instead of leaving
    // the palette: the chip says which page the results are narrowed to.
    if (event.key === "Backspace" && page !== "root" && query === "") {
      event.preventDefault();
      setPage("root");
    }
    if (event.key === "Tab") {
      // React Spectrum stops keydown propagation by default, which would keep
      // Tab from ever reaching the Modal's FocusScope trap and let focus
      // escape the dialog. Opt out so the trap wraps Tab instead; this is
      // what useAutocomplete itself intends for Tab ("We want FocusScope to
      // handle Tab if one exists"). useShortcuts pauses while this Modal is
      // open, so removal stays on the field handler below; the id is still
      // declared for the shortcut help.
      (event as unknown as { continuePropagation?: () => void }).continuePropagation?.();
    }
  };

  const handleSearchEscapeCapture = (event: KeyboardEvent<HTMLInputElement>) => {
    // Target phase runs before the SearchField wrapper's bubble handler, so
    // one Escape closes even if the wrapper never sees the key.
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  /** Enters a nested page: it narrows the list, it does not open anything. */
  const enterPage = (next: PalettePage) => {
    setPage(next);
    setQuery("");
  };

  /**
   * Leaves the palette and lands on the entity, Settings row, or page the
   * result named. Open editor text lands first: navigating away from a Chapter
   * with unsaved keystrokes would lose them.
   */
  const openResult = (item: PaletteItem) => {
    recordRecent(item.key);
    close();
    void (async () => {
      // Let the Modal unmount (and lift its gate) before moving.
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        await flushPendingEdits();
      } catch {
        toast.info(t("commandPalette.saveFailed"));
        return;
      }
      if (item.kind === "settingsRow") {
        focusSettingsRow(item.id as SettingsRowId);
        if (location.pathname !== "/settings") navigate("/settings");
        return;
      }
      if (item.kind === "book") {
        navigate(`/book/${item.id}`);
        return;
      }
      if (item.kind === "chapter") {
        navigate(`/book/${item.bookId}`, { state: { openChapterId: item.id } });
        return;
      }
      if (item.kind === "note") {
        navigate(`/notes/${item.id}`);
        return;
      }
      if (item.kind === "canvas") {
        navigate(`/canvas/${item.id}`);
      }
    })();
  };

  const choose = (item: PaletteItem) => {
    if (item.state === "disabled") return;
    if (item.kind === "page") {
      // A page is not a destination: it narrows the list and stays open.
      if (item.targetPage) enterPage(item.targetPage);
      return;
    }
    if (item.kind !== "command") {
      openResult(item);
      return;
    }
    const id = item.id as CommandId;
    const opener = useCommandPaletteStore.getState().opener;
    recordRecent(item.key);
    close();
    void (async () => {
      // Let the Modal unmount (and lift its gate) before running anything.
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (let attempt = 0; attempt < 10; attempt++) {
        if (useModalStore.getState().modalIds.length === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (opener && opener.isConnected) opener.focus();
      // Item bindings re-register once focus is back inside the item.
      for (let attempt = 0; attempt < 10; attempt++) {
        if (commandState(id) !== "hidden") break;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const outcome = await runCommand(id, { source: "palette" });
      if (outcome !== "ran") toast.info(t("commandPalette.unavailable"));
    })();
  };

  const chipLabel = page === "root" ? null : t(`commandPalette.chips.${page}`);

  return (
    <Modal
      isOpen
      onClose={close}
      title={t("commandPalette.title")}
      placement="top"
      unstyled
      panelClassName="relative mt-2 flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl modal-panel-drop"
    >
      <Autocomplete inputValue={query} onInputChange={changeQuery}>
        <SearchField
          onKeyDown={handleSearchKeyDown}
          className="flex shrink-0 items-center gap-2 p-1.5"
        >
          {/* Visually the placeholder says what to type; the label names the field. */}
          <Label className="sr-only">{t("commandPalette.searchLabel")}</Label>
          {/* The breadcrumb: which page narrowed the results. */}
          {chipLabel && (
            <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-sm text-foreground">
              {chipLabel}
            </span>
          )}
          <Input
            ref={inputRef}
            data-autofocus
            onKeyDown={handleSearchEscapeCapture}
            placeholder={t("commandPalette.placeholder")}
            className="h-8 min-w-0 flex-1 rounded-md border border-primary bg-background px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground pointer-coarse:h-11 [&::-webkit-search-cancel-button]:hidden"
          />
        </SearchField>
        {count === 0 ? (
          query.trim() !== "" && (
            <p className="px-3 pb-3 pt-1 text-sm text-muted-foreground">
              {t("commandPalette.noResults")}
            </p>
          )
        ) : (
          <Virtualizer layout={ListLayout} layoutOptions={LIST_LAYOUT_OPTIONS}>
            <ListBox
              aria-label={t("commandPalette.resultsLabel")}
              className="scrollbar-themed max-h-[min(60dvh,26rem)] min-h-0 pointer-coarse:max-h-[70dvh] overflow-y-auto outline-none"
            >
              {sections.map((section, sectionIndex) => (
                <ListBoxSection key={section.id} id={section.id}>
                  {/* A rule between sections, none above the first. */}
                  <Header
                    className={`mx-1.5 px-2 pt-0.5 text-right text-[11px] text-muted-foreground ${
                      sectionIndex === 0 ? "" : "mt-1 border-t border-border"
                    }`}
                  >
                    {t(`commandPalette.sections.${section.id}`)}
                  </Header>
                  {section.results.map((result) => (
                    <PaletteRow
                      key={result.item.key}
                      result={result}
                      isRecent={section.id === "recent"}
                      mac={mac}
                      onChoose={choose}
                      onRemoveRecent={removeByKey}
                    />
                  ))}
                </ListBoxSection>
              ))}
            </ListBox>
          </Virtualizer>
        )}
      </Autocomplete>
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
    </Modal>
  );
}

function renderHighlightedLabel(label: string, result: PaletteResult): ReactNode {
  if (result.highlights.length === 0) return label;
  const parts: ReactNode[] = [];
  let at = 0;
  // Unmatched text stays plain text nodes: wrapping it in elements makes the
  // accessible name drop the spaces at their edges.
  result.highlights.forEach(([start, end], index) => {
    if (start > at) parts.push(label.slice(at, start));
    parts.push(
      <mark key={`mark-${index}`} className="rounded-sm bg-primary/20 text-foreground">
        {label.slice(start, end)}
      </mark>
    );
    at = end;
  });
  if (at < label.length) parts.push(label.slice(at));
  return parts;
}

/** The icon each kind is recognized by, where the feature has one. */
const KIND_ICONS: Partial<Record<PaletteItemKind, ComponentType<{ className?: string }>>> = {
  book: ProjectsIcon,
  chapter: ChapterIcon,
  note: NotebookPen,
  canvas: Workflow,
  settingsRow: SettingsIcon,
};

/** A Command result's live Shortcuts; the other kinds are not Commands. */
function PaletteShortcuts({ id, mac }: { id: CommandId; mac: boolean }) {
  const shortcuts = useCommandKeys(id);
  return (
    <>
      {shortcuts.map((shortcut) => (
        <KeyboardShortcut
          key={shortcut.join(" ")}
          shortcut={formatShortcut(shortcut, mac)}
          className="shrink-0"
        />
      ))}
    </>
  );
}

interface PaletteRowProps {
  result: PaletteResult;
  isRecent: boolean;
  mac: boolean;
  onChoose: (item: PaletteItem) => void;
  onRemoveRecent: (key: string) => void;
}

function PaletteRow({ result, isRecent, mac, onChoose, onRemoveRecent }: PaletteRowProps) {
  const { t } = useTranslation();
  const item = result.item;
  const unavailable = item.state === "disabled";
  const Icon = KIND_ICONS[item.kind];
  // A disabled Command stays reachable with the arrow keys and announced as
  // disabled. React Aria offers either skipping disabled items or never
  // marking them, so the row stays an ordinary option and carries
  // aria-disabled itself; choosing it does nothing (see choose()).
  const markUnavailable = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      if (unavailable) node.setAttribute("aria-disabled", "true");
      else node.removeAttribute("aria-disabled");
    },
    [unavailable]
  );
  return (
    <ListBoxItem
      id={item.key}
      ref={markUnavailable}
      textValue={item.label}
      onAction={() => onChoose(item)}
      className={`mx-1 flex min-h-8 items-center gap-2 rounded-md px-2 text-sm text-foreground outline-none pointer-coarse:min-h-11 data-focused:bg-primary/15 data-focus-visible:ring-1 data-focus-visible:ring-inset data-focus-visible:ring-primary ${
        unavailable ? "cursor-default opacity-60" : "cursor-pointer"
      }`}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      {/* The label names the option; the detail and the live Shortcut are its
          description, so they are announced after the name, not glued to it. */}
      <Text slot="label" className="min-w-0 flex-1 truncate">
        {renderHighlightedLabel(item.label, result)}
      </Text>
      <Text slot="description" className="flex shrink-0 items-center gap-2">
        {item.detail && (
          <span className="truncate text-xs text-muted-foreground">{item.detail}</span>
        )}
        {item.kind === "command" && <PaletteShortcuts id={item.id as CommandId} mac={mac} />}
      </Text>
      {isRecent && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("commandPalette.removeItem", { label: item.label })}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            onRemoveRecent(item.key);
          }}
          className="shrink-0 rounded p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </ListBoxItem>
  );
}
