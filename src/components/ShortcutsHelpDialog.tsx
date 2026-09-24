import { useId } from "react";
import { useTranslation } from "react-i18next";
import { GraduationCap } from "lucide-react";
import { Button, Modal, KeyboardShortcut } from "@/components/ui";
import { useBoundShortcuts } from "@/lib/bound-shortcuts";
import { SHORTCUTS, formatKeys, type ShortcutId } from "@/lib/shortcut-registry";

interface ShortcutsHelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Runs this screen's Tutorial section; the dialog closes first. */
  onStartTutorial?: () => void;
}

const AREAS = [
  { prefix: "global.", labelKey: "shortcuts.areaGlobal" },
  { prefix: "home.", labelKey: "shortcuts.areaHome" },
  { prefix: "editor.", labelKey: "shortcuts.areaEditor" },
  { prefix: "canvas.", labelKey: "shortcuts.areaCanvas" },
  { prefix: "cover.", labelKey: "shortcuts.areaCover" },
  { prefix: "tutorial.", labelKey: "shortcuts.areaTutorial" },
] as const;

type AreaGroup = {
  prefix: string;
  labelKey: (typeof AREAS)[number]["labelKey"];
  ids: ShortcutId[];
};

const ALL_IDS = Object.keys(SHORTCUTS) as ShortcutId[];

function ShortcutRow({ id }: { id: ShortcutId }) {
  const { t } = useTranslation();
  const definition = SHORTCUTS[id];
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <span className="text-sm text-foreground">{t(definition.labelKey)}</span>
      <KeyboardShortcut shortcut={formatKeys(definition)} alwaysVisible />
    </li>
  );
}

function AreaGroups({ groups }: { groups: AreaGroup[] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.prefix} aria-label={t(group.labelKey)}>
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

export function ShortcutsHelpDialog({ isOpen, onClose, onStartTutorial }: ShortcutsHelpDialogProps) {
  const { t } = useTranslation();
  const thisScreenId = useId();
  const otherScreensId = useId();
  const bound = useBoundShortcuts();
  const boundSet = new Set(bound);

  const thisScreen = AREAS.map((area) => ({
    ...area,
    ids: bound.filter((id) => id.startsWith(area.prefix)),
  })).filter((area) => area.ids.length > 0);

  // Global shortcuts are bound on every screen, so one missing here is not
  // available on this device at all and belongs in neither list.
  const otherScreens = AREAS.filter((area) => area.prefix !== "global.")
    .map((area) => ({
      ...area,
      ids: ALL_IDS.filter((id) => id.startsWith(area.prefix) && !boundSet.has(id)),
    }))
    .filter((area) => area.ids.length > 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("shortcuts.title")} footer={null}>
      <div className="space-y-6">
        {onStartTutorial && (
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => {
              onClose();
              onStartTutorial();
            }}
          >
            <GraduationCap className="h-4 w-4" aria-hidden="true" />
            {t("tutorial.help.startForScreen")}
          </Button>
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
            <AreaGroups groups={thisScreen} />
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
            <AreaGroups groups={otherScreens} />
          </section>
        )}
      </div>
    </Modal>
  );
}
