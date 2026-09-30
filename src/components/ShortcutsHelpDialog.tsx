import { useId } from "react";
import { useTranslation } from "react-i18next";
import { GraduationCap } from "lucide-react";
import { Button, Modal, KeyboardShortcut } from "@/components/ui";
import { VoicePhraseSummary } from "@/components/shortcuts/VoicePhraseSummary";
import { useBoundShortcuts } from "@/lib/bound-shortcuts";
import { liveShortcuts, useCommandKeys } from "@/lib/command-keys";
import { formatShortcut, shortcutKey } from "@/lib/shortcut-keys";
import { isMac } from "@/lib/platform/detect";
import { dictationLanguageFor, useDictationStore } from "@/features/dictation/store";
import { voicePhrases } from "@/features/dictation/voice-commands";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import {
  COMMANDS,
  COMMAND_IDS,
  SHORTCUT_SECTIONS,
  commandSection,
  type CommandId,
} from "@/lib/shortcut-registry";

interface ShortcutsHelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Runs this screen's Tutorial section; the dialog closes first. */
  onStartTutorial?: () => void;
  /** Opens the shortcut editor. */
  onCustomize?: () => void;
}

type SectionLabelKey = (typeof SHORTCUT_SECTIONS)[number]["labelKey"];
type SectionGroup = { id: string; labelKey: SectionLabelKey; ids: CommandId[] };

function ShortcutRow({ id }: { id: CommandId }) {
  const { t, i18n } = useTranslation();
  const shortcuts = useCommandKeys(id);
  const enabled = useDictationStore((state) => state.enabled);
  const languageOverride = useDictationStore((state) => state.languageOverride);
  const customVoice = useShortcutSettingsStore((state) => state.shortcuts.voice);
  const voiceLanguage = dictationLanguageFor(languageOverride, i18n?.language);
  const phrases = enabled ? voicePhrases(id, voiceLanguage, customVoice) : [];
  if (shortcuts.length === 0) return null;
  if (!enabled || phrases.length === 0) {
    return (
      <li className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
        <span className="text-sm text-foreground">{t(COMMANDS[id].labelKey)}</span>
        <span className="inline-flex items-center gap-2">
          {shortcuts.map((shortcut) => (
            <KeyboardShortcut
              key={shortcutKey(shortcut)}
              shortcut={formatShortcut(shortcut, isMac())}
              alwaysVisible
            />
          ))}
        </span>
      </li>
    );
  }
  return (
    <li className="rounded-lg border border-border px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-foreground">{t(COMMANDS[id].labelKey)}</span>
        <span className="inline-flex items-center gap-2">
          {shortcuts.map((shortcut) => (
            <KeyboardShortcut
              key={shortcutKey(shortcut)}
              shortcut={formatShortcut(shortcut, isMac())}
              alwaysVisible
            />
          ))}
        </span>
      </div>
      <VoicePhraseSummary phrases={phrases} language={voiceLanguage} hideWhenEmpty />
    </li>
  );
}

function SectionGroups({ groups }: { groups: SectionGroup[] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.id} aria-label={t(group.labelKey)}>
          <h4 className="mb-2 text-sm font-medium text-foreground">{t(group.labelKey)}</h4>
          <ul className="space-y-2">
            {group.ids.map((id) => (
              <ShortcutRow key={id} id={id} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function groupsFor(ids: CommandId[]): SectionGroup[] {
  return SHORTCUT_SECTIONS.map((section) => ({
    id: section.id,
    labelKey: section.labelKey,
    ids: ids.filter((id) => commandSection(id) === section.id),
  })).filter((group) => group.ids.length > 0);
}

export function ShortcutsHelpDialog({
  isOpen,
  onClose,
  onStartTutorial,
  onCustomize,
}: ShortcutsHelpDialogProps) {
  const { t } = useTranslation();
  const thisScreenId = useId();
  const otherScreensId = useId();
  const bound = useBoundShortcuts();
  const boundSet = new Set(bound);
  const settings = useShortcutSettingsStore((state) => state.shortcuts);
  const hasLive = (id: CommandId) => liveShortcuts(id, settings).length > 0;

  const thisScreen = groupsFor(COMMAND_IDS.filter((id) => boundSet.has(id) && hasLive(id)));

  // Global shortcuts are bound on every screen, so one missing here is not
  // available on this device at all and belongs in neither list.
  const otherScreens = groupsFor(
    COMMAND_IDS.filter(
      (id) => !boundSet.has(id) && commandSection(id) !== "global" && hasLive(id)
    )
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("shortcuts.title")} footer={null}>
      <div className="space-y-6">
        {(onStartTutorial || onCustomize) && (
          <div className="flex flex-wrap gap-2">
            {onStartTutorial && (
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  onClose();
                  onStartTutorial();
                }}
              >
                <GraduationCap className="h-4 w-4" aria-hidden="true" />
                {t("tutorial.help.startForScreen")}
              </Button>
            )}
            {onCustomize && (
              <Button type="button" variant="secondary" className="flex-1" onClick={onCustomize}>
                {t("shortcuts.customize")}
              </Button>
            )}
          </div>
        )}
        <section aria-labelledby={thisScreenId}>
          <h3
            id={thisScreenId}
            className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {t("shortcuts.onThisScreen")}
          </h3>
          {thisScreen.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("shortcuts.none")}</p>
          ) : (
            <SectionGroups groups={thisScreen} />
          )}
        </section>

        {otherScreens.length > 0 && (
          <section aria-labelledby={otherScreensId} className="text-muted-foreground">
            <h3
              id={otherScreensId}
              className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {t("shortcuts.onOtherScreens")}
            </h3>
            <SectionGroups groups={otherScreens} />
          </section>
        )}
      </div>
    </Modal>
  );
}
