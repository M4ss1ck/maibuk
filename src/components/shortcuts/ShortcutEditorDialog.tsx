import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button as AriaButton,
  GridList,
  GridListHeader,
  GridListItem,
  GridListSection,
  Input,
  Label,
  ListLayout,
  SearchField,
  Virtualizer,
} from "react-aria-components";
import { Keyboard, List, Lock, Mic, PencilLine, Plus, RotateCcw, X } from "lucide-react";
import { Button, KeyboardShortcut, Modal, Switch } from "@/components/ui";
import { ResponsiveToggleGroup } from "@/components/ui/ResponsiveToggleGroup";
import { toast } from "@/components/ui/Toast";
import { ShortcutRecorder, describeShortcut } from "@/components/shortcuts/ShortcutRecorder";
import { VoicePhraseSummary } from "@/components/shortcuts/VoicePhraseSummary";
import { VoiceCommandsDialog } from "@/components/shortcuts/VoiceCommandsDialog";
import { MAX_SHORTCUTS_PER_COMMAND } from "@/constants";
import { findPhraseConflict } from "@/features/dictation/phrase-conflicts";
import { phraseWords } from "@/features/dictation/normalize";
import { dictationLanguageFor, useDictationStore } from "@/features/dictation/store";
import {
  inactiveVoicePhrasesOf,
  isVoiceEligible,
  voicePhrases,
} from "@/features/dictation/voice-commands";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { pickShortcutFileText, saveShortcutFile } from "@/features/settings/shortcut-file";
import { useCommandRegistryRevision } from "@/hooks/useCommandRegistryRevision";
import { isMac } from "@/lib/platform/detect";
import { IS_WEB } from "@/lib/platform/target";
import {
  SHORTCUT_SECTIONS,
  commandIds,
  commandLabel,
  commandSection,
  fixedShortcuts,
  getCommand,
  isCommandId,
  isPluginCommandDef,
  isSealedCommand,
  type CommandId,
  type Shortcut,
} from "@/lib/shortcut-registry";
import { formatShortcut, isSingleKey, isTypingSafe, shortcutKey } from "@/lib/shortcut-keys";
import {
  editableShortcuts,
  findConflicts,
  isBindingActive,
  parseShortcutFile,
  type Conflict,
  type LoadResult,
} from "@/lib/shortcut-resolve";

type Filter = "all" | "customized" | "none";

interface Recording {
  id: CommandId;
  /** Which editable Shortcut is being changed; null adds one. */
  index: number | null;
}

interface PendingConflict extends Recording {
  shortcut: Shortcut;
  conflicts: Conflict[];
}

/** Where focus goes once a recording, a removal, or a conflict ends. */
type FocusTarget = {
  id: CommandId;
  control: "change" | "add" | "reset" | "voice";
  index?: number;
} | null;

/**
 * Moves focus to a row's control once that row has re-rendered: the control
 * that had focus can vanish (a removed chip, a finished recording). It lives
 * inside the row because a virtualized row commits after the dialog's effects.
 */
function RowFocus({
  id,
  target,
  onDone,
}: {
  id: CommandId;
  target: FocusTarget;
  onDone: () => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!target || target.id !== id) return;
    const row = ref.current?.closest<HTMLElement>('[role="row"]');
    const control =
      row?.querySelector<HTMLElement>(`[data-focus-key="${focusKey(target)}"]`) ??
      row?.querySelector<HTMLElement>(`[data-focus-key="${focusKey({ id, control: "add" })}"]`);
    control?.focus();
    onDone();
  }, [id, target, onDone]);
  return <span ref={ref} hidden />;
}

function focusKey(target: NonNullable<FocusTarget>): string {
  return target.index === undefined
    ? `${target.id}:${target.control}`
    : `${target.id}:${target.control}:${target.index}`;
}

/**
 * ListLayout positions every item absolutely, which defeats CSS `sticky`. A sticky
 * layout info is rendered in normal flow inside its section instead, so each
 * section header stays on top until the next section pushes it off. The section
 * must allow overflow, or its `overflow: hidden` wrapper traps the header.
 */
class StickyHeaderListLayout<T> extends ListLayout<T> {
  getVisibleLayoutInfos(rect: Parameters<ListLayout<T>["getVisibleLayoutInfos"]>[0]) {
    const infos = super.getVisibleLayoutInfos(rect);
    for (const info of infos) {
      if (info.type === "section") info.allowOverflow = true;
      if (info.type !== "header") continue;
      info.isSticky = true;
      // Rows come later in the DOM; without this they paint over the header.
      info.zIndex = 1;
    }
    return infos;
  }
}

/**
 * With an overflowing section, React Aria sets a sticky item's `top` to its offset
 * in the whole list (a TODO in its VirtualizerItem), so the header's wrapper is
 * pinned back to the top of the scroll view.
 */
const STICKY_HEADER_TOP = "[&_div:has(>[data-sticky-section-header])]:top-0!";

const ROW_CONTROL =
  "inline-flex items-center gap-1 rounded-md px-1.5 py-1 pointer-coarse:px-2.5 pointer-coarse:py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary data-disabled:opacity-40";

interface ShortcutEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * The Shortcut Editor: every Command, its Fixed, Default, and Custom
 * Shortcuts, grouped in the same sections as the shortcut help (ADR 0012).
 */
export function ShortcutEditorDialog({ isOpen, onClose }: ShortcutEditorDialogProps) {
  const { t: translate, i18n } = useTranslation();
  // Command labels and reasons are registry data, so their keys are plain strings.
  const t = translate as unknown as (key: string, options?: Record<string, unknown>) => string;
  const settings = useShortcutSettingsStore((state) => state.shortcuts);
  const setCommandShortcuts = useShortcutSettingsStore((state) => state.setCommandShortcuts);
  const resetCommandShortcuts = useShortcutSettingsStore((state) => state.resetCommandShortcuts);
  const resetAllShortcuts = useShortcutSettingsStore((state) => state.resetAllShortcuts);
  const replaceCustomShortcuts = useShortcutSettingsStore((state) => state.replaceCustomShortcuts);
  const setSingleKeyEnabled = useShortcutSettingsStore(
    (state) => state.setSingleKeyShortcutsEnabled
  );

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [pending, setPending] = useState<PendingConflict | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null);
  const [announcement, setAnnouncement] = useState("");
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [loaded, setLoaded] = useState<Extract<LoadResult, { ok: true }> | null>(null);
  const [voiceFor, setVoiceFor] = useState<CommandId | null>(null);
  const languageOverride = useDictationStore((state) => state.languageOverride);
  const voiceLanguage = dictationLanguageFor(languageOverride, i18n?.language);
  const searchRef = useRef<HTMLInputElement>(null);

  const clearFocusTarget = useCallback(() => setFocusTarget(null), []);
  const label = (id: CommandId) => commandLabel(id, t, dictationLanguageFor(null, i18n?.language));
  const fixedReason = (id: CommandId): string | null => {
    const definition = getCommand(id);
    return isPluginCommandDef(definition) ? null : (definition.fixedReasonKey ?? null);
  };

  const customizedCount = new Set([...Object.keys(settings.custom), ...Object.keys(settings.voice)])
    .size;

  // A Plugin that registers or unregisters while the editor is open updates it.
  const revision = useCommandRegistryRevision();

  const sections = useMemo(() => {
    // A closed editor stays mounted to retain its query and filter, but must
    // not rebuild the Command catalog when another dialog opens (#376).
    if (!isOpen) return [];
    const needle = query.trim().toLowerCase();
    return SHORTCUT_SECTIONS.map((section) => ({
      ...section,
      ids: commandIds().filter((id) => {
        if (commandSection(id) !== section.id) return false;
        const editable = editableShortcuts(id, settings.custom, IS_WEB);
        const all = [...fixedShortcuts(id), ...editable];
        if (
          filter === "customized" &&
          settings.custom[id] === undefined &&
          settings.voice[id] === undefined
        ) {
          return false;
        }
        if (filter === "none" && all.length > 0) return false;
        if (!needle) return true;
        const spoken = isVoiceEligible(id) ? voicePhrases(id, voiceLanguage, settings.voice) : [];
        const haystack = [label(id), ...all.map(describeShortcut), ...all.flat(), ...spoken]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      }),
    })).filter((section) => section.ids.length > 0);
    // `t` changes with the language; the list must follow it. `revision`
    // changes with a Plugin registering or unregistering.
  }, [isOpen, query, filter, settings.custom, settings.voice, voiceLanguage, t, revision]);

  useEffect(() => {
    if (!focusTarget) return;
    if (sections.some((section) => section.ids.includes(focusTarget.id))) return;
    searchRef.current?.focus();
    clearFocusTarget();
  }, [focusTarget, sections, clearFocusTarget]);

  const announce = (message: string) => {
    // A repeated message must still be spoken.
    setAnnouncement("");
    queueMicrotask(() => setAnnouncement(message));
  };

  const validate = (id: CommandId, index: number | null) => (shortcut: Shortcut) => {
    const definition = getCommand(id);
    if (
      !isPluginCommandDef(definition) &&
      definition.source === "editor-keymap" &&
      !isTypingSafe(shortcut)
    ) {
      return t("shortcutEditor.errors.needsModifier", { keys: describeShortcut(shortcut) });
    }
    const fixed = fixedShortcuts(id);
    const own = [...fixed, ...editableShortcuts(id, settings.custom, IS_WEB)];
    const duplicate = own.findIndex((existing) => shortcutKey(existing) === shortcutKey(shortcut));
    const editableIndex = duplicate - fixed.length;
    if (duplicate !== -1 && editableIndex !== index) {
      return t("shortcutEditor.errors.duplicate", { keys: describeShortcut(shortcut) });
    }
    const locked = findConflicts(id, shortcut, settings.custom, IS_WEB).find((c) => c.locked);
    if (locked) {
      return t("shortcutEditor.errors.locked", {
        keys: describeShortcut(locked.shortcut),
        command: label(locked.id),
      });
    }
    return null;
  };

  const apply = ({ id, index, shortcut }: Recording & { shortcut: Shortcut }) => {
    const current = useShortcutSettingsStore.getState().shortcuts.custom;
    const list = editableShortcuts(id, current, IS_WEB);
    if (index === null) list.push(shortcut);
    else list[index] = shortcut;
    setCommandShortcuts(id, list);
  };

  const onRecord = (id: CommandId, index: number | null) => (shortcut: Shortcut) => {
    setRecording(null);
    const conflicts = findConflicts(id, shortcut, settings.custom, IS_WEB);
    if (conflicts.length > 0) {
      setPending({ id, index, shortcut, conflicts });
      announce(
        t("shortcutEditor.conflict.message", {
          keys: describeShortcut(shortcut),
          command: label(conflicts[0].id),
        })
      );
      return;
    }
    apply({ id, index, shortcut });
    const position = index ?? editableShortcuts(id, settings.custom, IS_WEB).length;
    setFocusTarget({ id, control: "change", index: position });
    announce(
      t("shortcutEditor.announce.set", { command: label(id), keys: describeShortcut(shortcut) })
    );
  };

  const replace = () => {
    if (!pending) return;
    const custom = useShortcutSettingsStore.getState().shortcuts.custom;
    for (const conflict of pending.conflicts) {
      const others = editableShortcuts(conflict.id, custom, IS_WEB).filter(
        (existing) => shortcutKey(existing) !== shortcutKey(conflict.shortcut)
      );
      setCommandShortcuts(conflict.id, others);
    }
    apply(pending);
    announce(
      t("shortcutEditor.announce.moved", {
        keys: describeShortcut(pending.shortcut),
        from: label(pending.conflicts[0].id),
        to: label(pending.id),
      })
    );
    setFocusTarget({ id: pending.id, control: "add" });
    setPending(null);
  };

  const cancelConflict = () => {
    if (!pending) return;
    setFocusTarget(
      pending.index === null
        ? { id: pending.id, control: "add" }
        : { id: pending.id, control: "change", index: pending.index }
    );
    setPending(null);
    announce(t("shortcutEditor.announce.cancelled"));
  };

  const remove = (id: CommandId, index: number) => {
    const list = editableShortcuts(id, settings.custom, IS_WEB);
    const [removed] = list.splice(index, 1);
    setCommandShortcuts(id, list);
    setFocusTarget({ id, control: "add" });
    announce(
      t("shortcutEditor.announce.removed", { command: label(id), keys: describeShortcut(removed) })
    );
  };

  const reset = (id: CommandId) => {
    resetCommandShortcuts(id);
    setFocusTarget({ id, control: "add" });
    const keys = editableShortcuts(id, {}, IS_WEB).map(describeShortcut).join(", ");
    announce(
      keys
        ? t("shortcutEditor.announce.reset", { command: label(id), keys })
        : t("shortcutEditor.announce.resetNone", { command: label(id) })
    );
  };

  const saveFile = async () => {
    try {
      if (await saveShortcutFile(settings.custom, settings.voice)) {
        toast.success(t("shortcutEditor.file.saved"));
      }
    } catch {
      toast.error(t("shortcutEditor.file.saveFailed"));
    }
  };

  const loadFile = async () => {
    let text: string | null;
    try {
      text = await pickShortcutFileText();
    } catch {
      toast.error(t("shortcutEditor.file.readFailed"));
      return;
    }
    if (text === null) return;
    // A Voice Command in the file must still mean one thing next to this
    // device's Spoken Punctuation, which the file does not carry.
    const { spokenPunctuation } = useDictationStore.getState();
    const result = parseShortcutFile(
      text,
      IS_WEB,
      ({ id, language, phrase, accepted }) =>
        findPhraseConflict({
          language,
          phrase,
          candidate: { kind: "voice", id },
          voice: accepted,
          spokenPunctuation: spokenPunctuation[language],
        }) !== null
    );
    if (!result.ok) {
      toast.error(t(`shortcutEditor.file.errors.${result.error}`));
      return;
    }
    setLoaded(result);
  };

  const chips = (id: CommandId) => {
    const fixed = fixedShortcuts(id);
    const editable = editableShortcuts(id, settings.custom, IS_WEB);
    const isRecordingHere = recording?.id === id;
    const off = (shortcut: Shortcut) => !settings.singleKeyEnabled && isSingleKey(shortcut);
    const commandLabel = label(id);
    // A Plugin binding another active binding already owns stays visible here
    // so the author can resolve it (ADR 0024).
    const inactive = (shortcut: Shortcut) =>
      !isBindingActive(id, shortcut, settings.custom, IS_WEB);

    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {fixed.map((shortcut) => (
          <span
            key={`fixed-${shortcutKey(shortcut)}`}
            className="inline-flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5"
          >
            <Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
            <KeyboardShortcut shortcut={formatShortcut(shortcut, isMac())} alwaysVisible />
            <span className="sr-only">{t("shortcutEditor.fixed")}</span>
          </span>
        ))}
        {editable.map((shortcut, index) =>
          isRecordingHere && recording.index === index ? (
            <ShortcutRecorder
              key={`recording-${index}`}
              commandLabel={commandLabel}
              validate={validate(id, index)}
              onRecord={onRecord(id, index)}
              onCancel={(reason) => {
                setRecording(null);
                if (reason === "escape") setFocusTarget({ id, control: "change", index });
                announce(t("shortcutEditor.announce.cancelled"));
              }}
              announce={announce}
            />
          ) : (
            <span
              key={`editable-${shortcutKey(shortcut)}`}
              className={`inline-flex items-center gap-0.5 rounded-md border border-border px-1 ${off(shortcut) ? "opacity-50" : ""}`}
            >
              <KeyboardShortcut shortcut={formatShortcut(shortcut, isMac())} alwaysVisible />
              {inactive(shortcut) && (
                <span className="px-1 text-[10px] text-destructive">
                  {t("shortcutEditor.inactive")}
                </span>
              )}
              {off(shortcut) && (
                <span className="px-1 text-[10px] text-muted-foreground">
                  {t("shortcutEditor.singleKeyOff")}
                </span>
              )}
              <AriaButton
                className={ROW_CONTROL}
                data-focus-key={focusKey({ id, control: "change", index })}
                aria-label={t("shortcutEditor.change", {
                  keys: describeShortcut(shortcut),
                  command: commandLabel,
                })}
                onPress={() => {
                  setPending(null);
                  setRecording({ id, index });
                }}
              >
                <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
              </AriaButton>
              <AriaButton
                className={ROW_CONTROL}
                aria-label={t("shortcutEditor.remove", {
                  keys: describeShortcut(shortcut),
                  command: commandLabel,
                })}
                onPress={() => remove(id, index)}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </AriaButton>
            </span>
          )
        )}
        {fixed.length + editable.length === 0 && !isRecordingHere && (
          <span className="text-xs text-muted-foreground">{t("shortcutEditor.noShortcut")}</span>
        )}
        {isRecordingHere && recording.index === null && (
          <ShortcutRecorder
            commandLabel={commandLabel}
            validate={validate(id, null)}
            onRecord={onRecord(id, null)}
            onCancel={(reason) => {
              setRecording(null);
              if (reason === "escape") setFocusTarget({ id, control: "add" });
              announce(t("shortcutEditor.announce.cancelled"));
            }}
            announce={announce}
          />
        )}
      </div>
    );
  };

  const voiceButton = (id: CommandId) =>
    isVoiceEligible(id) ? (
      <AriaButton
        className={ROW_CONTROL}
        data-focus-key={focusKey({ id, control: "voice" })}
        aria-label={t("shortcutEditor.voice.open", { command: label(id) })}
        onPress={() => {
          setPending(null);
          setVoiceFor(id);
        }}
      >
        <Mic className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="@lg:inline hidden">{t("shortcutEditor.voice.openShort")}</span>
      </AriaButton>
    ) : null;

  const voiceSummary = (id: CommandId) => {
    if (!isVoiceEligible(id)) return null;
    const phrases = voicePhrases(id, voiceLanguage, settings.voice);
    const inactivePhrases = new Set(
      inactiveVoicePhrasesOf(voiceLanguage, settings.voice)
        .filter((binding) => binding.id === id)
        .map((binding) => phraseWords(binding.phrase).join(" "))
    );
    return (
      <VoicePhraseSummary
        phrases={phrases}
        language={voiceLanguage}
        inactivePhrases={inactivePhrases}
      />
    );
  };

  const actions = (id: CommandId) => {
    if (isSealedCommand(id)) {
      return (
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-xs text-muted-foreground">{t("shortcutEditor.sealed")}</span>
          {voiceButton(id)}
        </div>
      );
    }
    const editableCount = editableShortcuts(id, settings.custom, IS_WEB).length;
    const atLimit = editableCount >= MAX_SHORTCUTS_PER_COMMAND;
    const commandLabel = label(id);
    return (
      <div className="flex shrink-0 items-center gap-1">
        {!(recording?.id === id && recording.index === null) && (
          <AriaButton
            className={ROW_CONTROL}
            isDisabled={atLimit}
            data-focus-key={focusKey({ id, control: "add" })}
            aria-label={
              atLimit
                ? t("shortcutEditor.addLimit", {
                    command: commandLabel,
                    max: MAX_SHORTCUTS_PER_COMMAND,
                  })
                : t("shortcutEditor.add", { command: commandLabel })
            }
            onPress={() => {
              setPending(null);
              setRecording({ id, index: null });
            }}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="@lg:inline hidden">{t("shortcutEditor.addShort")}</span>
          </AriaButton>
        )}
        {settings.custom[id] !== undefined && (
          <AriaButton
            className={ROW_CONTROL}
            data-focus-key={focusKey({ id, control: "reset" })}
            aria-label={t("shortcutEditor.reset", { command: commandLabel })}
            onPress={() => reset(id)}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="@lg:inline hidden">{t("shortcutEditor.resetShort")}</span>
          </AriaButton>
        )}
        {voiceButton(id)}
      </div>
    );
  };

  const conflictNotice = (id: CommandId) => {
    if (pending?.id !== id) return null;
    const first = pending.conflicts[0];
    return (
      <div
        role="alert"
        className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs"
      >
        <span className="text-foreground">
          {t("shortcutEditor.conflict.message", {
            keys: describeShortcut(pending.shortcut),
            command: label(first.id),
          })}
        </span>
        <AriaButton autoFocus className={ROW_CONTROL} onPress={replace}>
          {t("shortcutEditor.conflict.replace")}
        </AriaButton>
        <AriaButton className={ROW_CONTROL} onPress={cancelConflict}>
          {t("common.cancel")}
        </AriaButton>
      </div>
    );
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={t("shortcutEditor.title")}
        size="wide"
        contentClassName="flex min-h-0 flex-col gap-3 overflow-hidden"
      >
        <div className="@container flex min-h-0 flex-1 flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("shortcutEditor.intro")}</p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Switch
                checked={settings.singleKeyEnabled}
                onChange={setSingleKeyEnabled}
                label={t("shortcutEditor.singleKey")}
              />
              {/* The Switch names itself for screen readers; this is the visible label. */}
              <span aria-hidden="true" className="text-sm font-medium">
                {t("shortcutEditor.singleKey")}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={saveFile}>
                {t("shortcutEditor.file.save")}
              </Button>
              <Button variant="secondary" size="sm" onClick={loadFile}>
                {t("shortcutEditor.file.load")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={customizedCount === 0}
                onClick={() => setConfirmResetAll(true)}
              >
                {t("shortcutEditor.resetAll")}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <SearchField
              value={query}
              onChange={setQuery}
              className="flex min-w-48 flex-1 flex-col gap-1"
            >
              <Label className="text-xs text-muted-foreground">{t("shortcutEditor.search")}</Label>
              <Input
                ref={searchRef}
                placeholder={t("shortcutEditor.searchPlaceholder")}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </SearchField>
            <ResponsiveToggleGroup<Filter>
              value={filter}
              onChange={setFilter}
              testId="shortcut-editor-filter"
              options={[
                {
                  value: "all",
                  label: t("shortcutEditor.filter.all"),
                  icon: <List className="h-4 w-4" />,
                  labelTestId: "shortcut-filter-all",
                },
                {
                  value: "customized",
                  label: t("shortcutEditor.filter.customized"),
                  icon: <PencilLine className="h-4 w-4" />,
                  labelTestId: "shortcut-filter-customized",
                },
                {
                  value: "none",
                  label: t("shortcutEditor.filter.none"),
                  icon: <Keyboard className="h-4 w-4" />,
                  labelTestId: "shortcut-filter-none",
                },
              ]}
            />
          </div>
          <p className="hidden text-xs text-muted-foreground pointer-coarse:block">
            {t("shortcutEditor.connectKeyboard")}
          </p>
          <div role="status" aria-live="polite" className="sr-only">
            {announcement}
          </div>
          {sections.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("shortcutEditor.empty")}
            </p>
          ) : (
            <Virtualizer
              layout={StickyHeaderListLayout}
              layoutOptions={{ estimatedRowHeight: 56, estimatedHeadingHeight: 36 }}
            >
              <GridList
                aria-label={t("shortcutEditor.listLabel")}
                // scroll-pt on the list and scroll-mt on rows keep a row focused at the top edge
                // below the sticky header: WebKit honours only one of them on some scroll paths.
                className={`min-h-0 flex-1 overflow-auto scroll-pt-12 rounded-lg border border-border ${STICKY_HEADER_TOP}`}
                style={{ height: "min(60dvh, 36rem)" }}
              >
                {sections.map((section) => (
                  <GridListSection
                    key={section.id}
                    id={section.id}
                    // A sticky header can only travel inside its parent; fill the section's box.
                    className="h-full"
                  >
                    <GridListHeader
                      data-sticky-section-header
                      className="border-b border-border bg-card px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {t(section.labelKey)}
                    </GridListHeader>
                    {section.ids.map((id) => (
                      <GridListItem
                        key={id}
                        id={id}
                        textValue={label(id)}
                        className="scroll-mt-12 border-b border-border px-3 py-2 outline-none data-focus-visible:ring-2 data-focus-visible:ring-inset data-focus-visible:ring-primary"
                      >
                        <div className="flex flex-col gap-2 @2xl:grid @2xl:grid-cols-[minmax(10rem,14rem)_1fr_auto] @2xl:items-center">
                          <div className="min-w-0">
                            <p className="truncate text-sm text-foreground">{label(id)}</p>
                            {fixedReason(id) && (
                              <p className="text-xs text-muted-foreground">
                                {t(fixedReason(id) ?? "")}
                              </p>
                            )}
                          </div>
                          {chips(id)}
                          {actions(id)}
                        </div>
                        {voiceSummary(id)}
                        {conflictNotice(id)}
                        <RowFocus id={id} target={focusTarget} onDone={clearFocusTarget} />
                      </GridListItem>
                    ))}
                  </GridListSection>
                ))}
              </GridList>
            </Virtualizer>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={confirmResetAll}
        onClose={() => setConfirmResetAll(false)}
        title={t("shortcutEditor.resetAllTitle")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmResetAll(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                resetAllShortcuts();
                setConfirmResetAll(false);
                announce(t("shortcutEditor.announce.resetAll"));
              }}
            >
              {t("shortcutEditor.resetAll")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-foreground">
          {t("shortcutEditor.resetAllBody", { count: customizedCount })}
        </p>
      </Modal>

      <Modal
        isOpen={loaded !== null}
        onClose={() => setLoaded(null)}
        title={t("shortcutEditor.file.previewTitle")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLoaded(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (!loaded) return;
                replaceCustomShortcuts(loaded.custom, loaded.voice);
                setLoaded(null);
                announce(t("shortcutEditor.file.loaded"));
              }}
            >
              {t("shortcutEditor.file.replace")}
            </Button>
          </>
        }
      >
        {loaded && (
          <div className="space-y-2 text-sm text-foreground">
            <p>
              {t("shortcutEditor.file.previewBody", {
                count: new Set([...Object.keys(loaded.custom), ...Object.keys(loaded.voice)]).size,
              })}
            </p>
            {loaded.dropped.length > 0 && (
              <>
                <p className="text-muted-foreground">
                  {t("shortcutEditor.file.droppedTitle", { count: loaded.dropped.length })}
                </p>
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  {loaded.dropped.map((item, index) => (
                    <li key={`${item.id}-${index}`}>
                      {t(
                        item.language
                          ? `shortcutEditor.file.droppedVoice.${item.reason}`
                          : `shortcutEditor.file.dropped.${item.reason}`,
                        {
                          command: isCommandId(item.id) ? label(item.id) : item.id,
                          keys: item.shortcut ? item.shortcut.join(" ") : "",
                          phrase: item.phrase ?? "",
                          language: item.language
                            ? t(`dictation.languageNames.${item.language}`)
                            : "",
                        }
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </Modal>

      <VoiceCommandsDialog
        id={voiceFor}
        initialLanguage={voiceLanguage}
        onClose={() => {
          if (voiceFor) setFocusTarget({ id: voiceFor, control: "voice" });
          setVoiceFor(null);
        }}
      />
    </>
  );
}
