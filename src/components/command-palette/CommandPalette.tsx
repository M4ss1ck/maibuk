import {
  memo,
  useCallback,
  useDeferredValue,
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
import {
  buildCommandItems,
  buildEntityItems,
  buildPageItems,
  buildSettingsItems,
  liveRecentKeys,
  loadPaletteEntities,
  paletteModeOf,
  paletteQueryText,
  PALETTE_COMMAND_PREFIX,
  preparePaletteIndex,
  searchLibrary,
  searchPalette,
  useCommandPaletteRecentStore,
  useCommandPaletteStore,
} from "@/features/command-palette";
import type {
  PaletteItem,
  PaletteItemKind,
  PaletteMode,
  PalettePage,
  PaletteResult,
  PaletteTranslate,
} from "@/features/command-palette/palette-index";
import type { SettingsRowId } from "@/components/settings/settings-sections";
import { focusSettingsRow } from "@/features/settings/focus-row";
import { currentSettingsPlatform } from "@/features/settings/rows";
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
 * The Command Palette dialog in its two modes: a leading `>` asks for Commands,
 * Plugin Commands, and Settings rows; its absence asks Library Search for a
 * Book, Chapter, Note, or Canvas by title. Each mode lists its own device-local
 * Recent, and an empty field suggests what to start with. Mounted once beside
 * GlobalShortcuts (so never on /embed); renders only while open, and the index
 * is prepared once per open, never per keystroke.
 */
export function CommandPalette() {
  const isOpen = useCommandPaletteStore((state) => state.isOpen);
  if (!isOpen) return null;
  return <OpenCommandPalette />;
}

// A result row is exactly one 32px line on a fine pointer (`min-h-8`,
// single-line text); a coarse pointer raises the row to 44px (`min-h-11`) for
// touch. A fixed size is not just an estimate: the virtualizer measures
// estimated rows with a forced layout on every mount, which WebKit cannot
// afford per keystroke (#552). On a coarse pointer the row can grow with text
// scaling, so it stays estimated. Padding keeps the last row's focus ring
// inside the scroll box.
const FINE_POINTER_LAYOUT = { rowSize: 32, estimatedHeadingSize: 22, padding: 4 };
const COARSE_POINTER_LAYOUT = { estimatedRowSize: 44, estimatedHeadingSize: 22, padding: 4 };

/** Whether the primary pointer is a finger, so the rows take their 44px size. */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true
  );
  useEffect(() => {
    const query = window.matchMedia?.("(pointer: coarse)");
    if (!query) return;
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return coarse;
}

function OpenCommandPalette() {
  const { t, i18n } = useTranslation();
  const coarsePointer = useCoarsePointer();
  const layoutOptions = coarsePointer ? COARSE_POINTER_LAYOUT : FINE_POINTER_LAYOUT;
  const close = useCommandPaletteStore((state) => state.close);
  const snapshot = useCommandPaletteStore((state) => state.snapshot);
  const customVoice = useShortcutSettingsStore((state) => state.shortcuts.voice);
  const recentKeys = useCommandPaletteRecentStore((state) => state.keys);
  const recordRecent = useCommandPaletteRecentStore((state) => state.record);
  const removeRecent = useCommandPaletteRecentStore((state) => state.remove);
  const pruneRecent = useCommandPaletteRecentStore((state) => state.prune);
  const [query, setQuery] = useState(() => useCommandPaletteStore.getState().initialQuery);
  const [page, setPage] = useState<PalettePage>("root");
  const [activeKeyIsRecent, setActiveKeyIsRecent] = useState(false);
  const [entities, setEntities] = useState<Awaited<ReturnType<typeof loadPaletteEntities>> | null>(
    null
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const announcementRef = useRef<HTMLDivElement>(null);
  const activeKeyRef = useRef<string | null>(null);
  const removalRef = useRef(false);
  const previousCountRef = useRef(-1);
  // Null until the first render has settled the mode the palette opened in.
  const previousModeRef = useRef<PaletteMode | null>(null);
  const mac = isMac();
  const navigate = useNavigate();
  const location = useLocation();
  const openBookId = useMatch("/book/:bookId")?.params.bookId ?? null;
  const announce = useCallback((message: string) => {
    if (announcementRef.current) announcementRef.current.textContent = message;
  }, []);

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

  // Read names once per open without refreshing the app behind the dialog.
  // Commands and Suggested appear immediately; Library rows merge in later.
  useEffect(() => {
    let cancelled = false;
    void loadPaletteEntities().then((loaded) => {
      if (!cancelled) setEntities(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pageItems = useMemo(() => buildPageItems({ t: translate }), [translate]);
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

  // The field shows every keystroke immediately; the ranked list follows in a
  // background render, so the keystroke's frame only carries the input echo.
  // The results are the same, one frame later; a key pressed inside that
  // window acts on the row the author still sees (useDeferredValue, #552).
  const deferredQuery = useDeferredValue(query);
  // The mode is the leading `>`, never a switch: the same input both says which
  // mode and what to search for, so deleting the prefix changes the mode back.
  const mode: PaletteMode = paletteModeOf(deferredQuery);
  const searchText = paletteQueryText(deferredQuery);
  const sections = useMemo(
    () =>
      mode === "commands"
        ? searchPalette(index, {
            mode,
            query: searchText,
            page: "root",
            recent: recentKeys,
            openBookId,
          })
        : searchLibrary({ index, query: searchText, page, recent: recentKeys, openBookId }),
    [index, mode, searchText, page, recentKeys, openBookId]
  );
  const flatResults = useMemo(() => sections.flatMap((section) => section.results), [sections]);
  const count = flatResults.length;
  const recentKeySet = useMemo(() => new Set(recentKeys), [recentKeys]);

  // The count and the removal confirmation share one live region: a removal
  // wins over the count change it causes. A removal may change no count at
  // all (a Suggested row fills the place), so it announces itself.
  //
  // The text goes straight into the region: a keystroke changes the count, and
  // storing the message in state would re-render the whole result list once
  // more per keystroke (measured on the WebKit palette probe, #552).
  useEffect(() => {
    if (previousCountRef.current === count) return;
    previousCountRef.current = count;
    if (removalRef.current) {
      removalRef.current = false;
      return;
    }
    // A nested page with an empty query announces the page, not the count the
    // deferred query is about to replace; its own results are "N results".
    if (page !== "root" && searchText === "") return;
    announce(t("commandPalette.resultCount", { count }));
  }, [count, t, page, searchText, announce]);

  // Entering or leaving a nested page is announced after the count it changes,
  // so this effect sits below the count's on purpose.
  useEffect(() => {
    if (page === "root") return;
    announce(t("commandPalette.pageAnnouncement", { page: t(`commandPalette.chips.${page}`) }));
  }, [page, t, announce]);

  // A mode change changes what the list holds, so it is announced last: the
  // author hears "Commands mode" or "Search" over the count it caused.
  // The first mode is the one the palette opened in, already known from the
  // Command that opened it, so only a change speaks.
  useEffect(() => {
    const previous = previousModeRef.current;
    previousModeRef.current = mode;
    if (previous === null || previous === mode) return;
    announce(t(`commandPalette.modes.${mode}`));
  }, [mode, t, announce]);

  // The active result lives in React Aria's virtual focus (the caret stays in
  // the field), so read it off the input's active descendant. Only the one
  // fact the palette reacts to is state: whether the active row is a Recent
  // row, which binds Shift+Delete. Tracking the key itself re-rendered the
  // list on every arrow that moved, even though nothing visible changed.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const sync = () => {
      const id = input.getAttribute("aria-activedescendant");
      const key = (id ? document.getElementById(id)?.getAttribute("data-key") : null) ?? null;
      activeKeyRef.current = key;
      const isRecent = key !== null && recentKeySet.has(key);
      setActiveKeyIsRecent((previous) => (previous === isRecent ? previous : isRecent));
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(input, { attributes: true, attributeFilter: ["aria-activedescendant"] });
    return () => observer.disconnect();
  }, [recentKeySet]);

  // useShortcuts pauses while this Modal is open, so Shift+Delete is handled
  // on the field itself; the id is still declared for the shortcut help.
  useBoundShortcutIds(["commandPalette.removeRecent"], activeKeyIsRecent);

  const removeByKey = useCallback(
    (key: string) => {
      removalRef.current = true;
      announce(t("commandPalette.removedFromRecent"));
      removeRecent(key);
    },
    [announce, t, removeRecent]
  );

  const changeQuery = useCallback(
    (value: string) => {
      // Typing after a removal that changed no count: the next count is news.
      removalRef.current = false;
      // `>` always means Commands, so it also leaves a nested Library page
      // instead of searching inside it.
      if (paletteModeOf(value) === "commands" && page !== "root") setPage("root");
      setQuery(value);
    },
    [page]
  );

  const removeActiveRecent = () => {
    const activeKey = activeKeyRef.current;
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
    // Backspace on the lone `>` leaves Commands mode for Library Search with
    // an empty field, so one keystroke walks back to where the palette started
    // instead of closing it.
    if (event.key === "Backspace" && page === "root" && query === PALETTE_COMMAND_PREFIX) {
      const input = inputRef.current;
      const caretAfterPrefix = input !== null && input.selectionStart === 1 && input.selectionEnd === 1;
      if (caretAfterPrefix) {
        event.preventDefault();
        changeQuery("");
        return;
      }
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
  const enterPage = useCallback((next: PalettePage) => {
    setPage(next);
    setQuery("");
  }, []);

  /**
   * Leaves the palette and lands on the entity, Settings row, or page the
   * result named. Open editor text lands first: navigating away from a Chapter
   * with unsaved keystrokes would lose them.
   */
  const openResult = useCallback(
    (item: PaletteItem) => {
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
    },
    [recordRecent, close, t, navigate, location.pathname]
  );

  const choose = useCallback(
    (item: PaletteItem) => {
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
    },
    [enterPage, openResult, recordRecent, close, t]
  );

  const renderedSections = useMemo(
    () =>
      sections.map((section, sectionIndex) => (
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
      )),
    [sections, mac, choose, removeByKey, t]
  );

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
          searchText.trim() !== "" && (
            <p className="px-3 pb-3 pt-1 text-sm text-muted-foreground">
              {t("commandPalette.noResults")}
            </p>
          )
        ) : (
          <Virtualizer layout={ListLayout} layoutOptions={layoutOptions}>
            <ListBox
              aria-label={t("commandPalette.resultsLabel")}
              className="scrollbar-themed max-h-[min(60dvh,26rem)] min-h-0 pointer-coarse:max-h-[70dvh] overflow-y-auto outline-none"
            >
              {renderedSections}
            </ListBox>
          </Virtualizer>
        )}
      </Autocomplete>
      <div ref={announcementRef} aria-live="polite" role="status" className="sr-only" />
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

const PaletteRow = memo(function PaletteRow({
  result,
  isRecent,
  mac,
  onChoose,
  onRemoveRecent,
}: PaletteRowProps) {
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
});
