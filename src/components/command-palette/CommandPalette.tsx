import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
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
import { X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { KeyboardShortcut } from "@/components/ui/KeyboardShortcut";
import { toast } from "@/components/ui/Toast";
import { useModalStore } from "@/components/ui/modal-store";
import {
  buildCommandItems,
  liveRecentKeys,
  preparePaletteIndex,
  searchPalette,
  useCommandPaletteRecentStore,
  useCommandPaletteStore,
} from "@/features/command-palette";
import type { PaletteItem, PaletteResult } from "@/features/command-palette/palette-index";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { normalizeLanguage } from "@/features/settings/types";
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

const LIST_LAYOUT_OPTIONS = { estimatedRowSize: 44, estimatedHeadingSize: 28 };

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
  const [announcement, setAnnouncement] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const removalRef = useRef(false);
  const previousCountRef = useRef(-1);
  const mac = isMac();

  const items = useMemo(
    () =>
      buildCommandItems({
        snapshot,
        t: t as unknown as (
          key: string,
          options?: Record<string, unknown>
        ) => string | readonly string[],
        language: normalizeLanguage(i18n.language),
        customVoice,
      }),
    [snapshot, t, i18n.language, customVoice]
  );
  const index = useMemo(() => preparePaletteIndex(items), [items]);

  // Drop Recent entries that resolve to nothing, silently.
  useEffect(() => {
    pruneRecent(liveRecentKeys(index, recentKeys));
  }, [index, pruneRecent, recentKeys]);

  const sections = useMemo(
    () => searchPalette(index, { query, page: "root", recent: recentKeys, openBookId: null }),
    [index, query, recentKeys]
  );
  const flatResults = useMemo(() => sections.flatMap((section) => section.results), [sections]);
  const count = flatResults.length;
  const recentKeySet = useMemo(() => new Set(recentKeys), [recentKeys]);

  // The count and the removal confirmation share one live region: a removal
  // wins over the count change it causes.
  useEffect(() => {
    if (previousCountRef.current === count && !removalRef.current) return;
    previousCountRef.current = count;
    if (removalRef.current) {
      removalRef.current = false;
      setAnnouncement(t("commandPalette.removedFromRecent"));
    } else {
      setAnnouncement(t("commandPalette.resultCount", { count }));
    }
  }, [count, t]);

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
    removeRecent(key);
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
    if (event.key === "Delete" && event.shiftKey) {
      event.preventDefault();
      removeActiveRecent();
      return;
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

  const choose = (item: PaletteItem) => {
    if (item.kind !== "command" || item.state === "disabled") return;
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

  const showHint = query.trim() === "" && count === 0;

  return (
    <Modal isOpen onClose={close} title={t("commandPalette.title")}>
      <div className="flex min-h-0 flex-col gap-2">
        <Autocomplete inputValue={query} onInputChange={setQuery}>
          <SearchField onKeyDown={handleSearchKeyDown} className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">{t("commandPalette.searchLabel")}</Label>
            <Input
              ref={inputRef}
              data-autofocus
              placeholder={t("commandPalette.placeholder")}
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </SearchField>
          {showHint ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("commandPalette.emptyHint")}
            </p>
          ) : count === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("commandPalette.noResults")}
            </p>
          ) : (
            <Virtualizer layout={ListLayout} layoutOptions={LIST_LAYOUT_OPTIONS}>
              <ListBox
                aria-label={t("commandPalette.resultsLabel")}
                className="max-h-[50vh] min-h-0 overflow-y-auto rounded-lg outline-none"
              >
                {sections.map((section) => (
                  <ListBoxSection key={section.id} id={section.id}>
                    <Header className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
  // Every row is a Command in this slice; later kinds branch here.
  const shortcuts = useCommandKeys(item.id as CommandId);
  const unavailable = item.state === "disabled";
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
      className={`mx-1 flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-foreground outline-none data-focus-visible:ring-2 data-focus-visible:ring-primary data-focused:bg-muted ${
        unavailable ? "cursor-default opacity-60" : "cursor-pointer"
      }`}
    >
      {/* The label names the option; the detail and the live Shortcut are its
          description, so they are announced after the name, not glued to it. */}
      <Text slot="label" className="min-w-0 flex-1 truncate">
        {renderHighlightedLabel(item.label, result)}
      </Text>
      <Text slot="description" className="flex shrink-0 items-center gap-2">
        {item.detail && (
          <span className="truncate text-xs text-muted-foreground">{item.detail}</span>
        )}
        {item.kind === "command" &&
          shortcuts.map((shortcut) => (
            <KeyboardShortcut
              key={shortcut.join(" ")}
              shortcut={formatShortcut(shortcut, mac)}
              className="shrink-0"
            />
          ))}
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
