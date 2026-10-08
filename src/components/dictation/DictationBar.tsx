import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Mic, MicOff, Loader2, Settings2 } from "lucide-react";
import { ChevronIcon } from "@/components/icons";
import { Select, selectTriggerClassName } from "@/components/ui/Select";
import { installedDictationLanguages, setDictationLanguage } from "@/features/dictation/language";
import { getDictation } from "@/features/dictation/runtime";
import { useDictationStore } from "@/features/dictation/store";
import type { DictationLanguage } from "@/features/dictation/types";
import { focusSettingsRow } from "@/features/settings/focus-row";
import { useShortcuts } from "@/lib/shortcuts";
import { useCommandHint } from "@/lib/command-keys";
import type { FormattedShortcut } from "@/lib/shortcut-keys";

const AUTO = "auto";

/** The two drawn sizes; Hidden draws the Compact microphone while listening. */
type BarLayout = "full" | "compact";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/**
 * Every part's classes per size. The live bar and its Settings preview both
 * read these, so the preview is the bar's real size on this pointer. Touch
 * targets stay 48px on coarse pointers at either size.
 */
const LAYOUT = {
  full: {
    frame: "gap-1 rounded-lg p-1",
    button: "h-10 w-10 rounded-lg pointer-coarse:h-12 pointer-coarse:w-12",
    icon: "h-5 w-5",
    language: "w-20",
    languageTrigger: "pointer-coarse:min-h-12",
    languageVariant: "default",
  },
  compact: {
    frame: "gap-0.5 rounded-lg p-0.5",
    button: "h-8 w-8 rounded pointer-coarse:h-12 pointer-coarse:w-12",
    icon: "h-4 w-4",
    language: "w-7 pointer-coarse:w-10",
    languageTrigger: "h-8 w-full pointer-coarse:h-12",
    languageVariant: "chip",
  },
} as const;

const FRAME_CLASS = "flex items-center border border-border bg-card shadow-lg";

/** The size of the color split trigger beside Text color and Highlight in the editor toolbar. */
const COLLAPSE_CLASS = `inline-flex h-8 w-4 shrink-0 items-center justify-center rounded-r border-l border-border/50 text-foreground transition-colors hover:bg-muted/20 pointer-coarse:h-12 pointer-coarse:w-6 ${FOCUS_RING}`;

/** The caret matches the other buttons' icons in color and stroke, at toolbar-caret size. */
const CARET_ICON = "h-3.5 w-3.5 shrink-0";

function buttonClass(layout: BarLayout, active = false) {
  return `relative inline-flex items-center justify-center ${LAYOUT[layout].button} ${FOCUS_RING} ${
    active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted/20"
  }`;
}

/** A formatted shortcut as readable text for an aria-label / title. */
function hintText(formatted: FormattedShortcut): string {
  return formatted.groups.map((chips) => chips.join("+")).join(" ");
}

/**
 * The Dictation Bar: one per editor screen, fixed to its bottom right; every
 * editor on the screen shares it. Its size comes from Settings; Hidden shows
 * only the microphone while a Dictation Session runs, so a Session is never
 * on without a visible way to stop it.
 */
export function DictationBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const support = useDictationStore((s) => s.support);
  const enabled = useDictationStore((s) => s.enabled);
  const snapshot = useDictationStore((s) => s.snapshot);
  const installed = useDictationStore((s) => s.installed);
  const languageOverride = useDictationStore((s) => s.languageOverride);
  const barSize = useDictationStore((s) => s.barSize);
  const barCollapsed = useDictationStore((s) => s.barCollapsed);
  const toggleBarCollapsed = useDictationStore((s) => s.toggleBarCollapsed);
  const hint = useCommandHint("dictation.toggle");

  const shown = enabled && !!support?.supported;
  useShortcuts([
    {
      id: "dictation.toggleBar",
      allowInInput: true,
      enabled: shown && barSize !== "hidden",
      onTrigger: toggleBarCollapsed,
    },
  ]);

  // Unsupported builds reject when the runtime cannot be built; the bar
  // simply stays unrendered instead of throwing at mount.
  useEffect(() => {
    void getDictation().catch(() => {});
  }, []);

  const languages = installedDictationLanguages(installed);

  if (!shown) return null;

  const listening = snapshot.status === "listening" || snapshot.status === "stopping";
  const loading = snapshot.status === "loading";
  const hidden = barSize === "hidden";
  if (hidden && !listening && !loading) return null;

  const layout: BarLayout = barSize === "full" ? "full" : "compact";
  const L = LAYOUT[layout];
  const collapsed = hidden || barCollapsed;
  const noModel = languages.length === 0;
  const openSettings = () => {
    focusSettingsRow("dictationEnabled", { align: "section" });
    navigate("/settings");
  };

  const label = noModel
    ? t("dictation.downloadModel")
    : listening
      ? t("dictation.stop")
      : t("dictation.start");
  const hintLabel = hint ? ` (${hintText(hint.formatted)})` : "";
  const ring = listening ? Math.min(1, snapshot.level * 4) : 0;

  return (
    <div className="fixed bottom-4 right-4 z-30">
      <div data-bar-part="frame" className={`${FRAME_CLASS} ${L.frame}`}>
      <button
        type="button"
        data-bar-part="mic"
        data-command="dictation.toggle"
        aria-pressed={noModel ? undefined : listening}
        aria-label={`${label}${hintLabel}`}
        title={`${label}${hintLabel}`}
        onClick={() =>
          noModel
            ? openSettings()
            : void getDictation()
                .then((r) => r.session.toggle())
                .catch(() => {})
        }
        className={buttonClass(layout, listening)}
        style={
          listening
            ? {
                boxShadow: `0 0 0 ${2 + ring * 6}px color-mix(in oklab, var(--color-primary) 35%, transparent)`,
              }
            : undefined
        }
      >
        {loading ? (
          <Loader2 className={`${L.icon} animate-spin`} aria-hidden />
        ) : noModel ? (
          <MicOff className={L.icon} aria-hidden />
        ) : (
          <Mic className={L.icon} aria-hidden />
        )}
      </button>
      {!collapsed && !noModel && (
        <div data-bar-part="language" className={L.language}>
          <Select<string>
            ariaLabel={t("dictation.language")}
            variant={L.languageVariant}
            minWidth="none"
            triggerClassName={L.languageTrigger}
            value={languageOverride ?? AUTO}
            options={[
              { value: AUTO, label: AUTO, accessibleName: t("dictation.languageAuto") },
              ...languages.map((l) => ({
                value: l,
                label: l,
                accessibleName: t(`dictation.languageNames.${l}`),
              })),
            ]}
            onChange={(value) => {
              void setDictationLanguage(
                value === AUTO ? null : (value as DictationLanguage)
              ).catch(() => {});
            }}
          />
        </div>
      )}
      {!collapsed && (
        <button
          type="button"
          data-bar-part="settings"
          aria-label={t("dictation.settings")}
          title={t("dictation.settings")}
          onClick={openSettings}
          className={buttonClass(layout)}
        >
          <Settings2 className={L.icon} aria-hidden />
        </button>
      )}
      {!hidden && (
        <button
          type="button"
          data-bar-part="collapse"
          data-command="dictation.toggleBar"
          aria-expanded={!barCollapsed}
          aria-label={barCollapsed ? t("dictation.bar.expand") : t("dictation.bar.collapse")}
          title={barCollapsed ? t("dictation.bar.expand") : t("dictation.bar.collapse")}
          onClick={toggleBarCollapsed}
          className={COLLAPSE_CLASS}
        >
          {barCollapsed ? (
            <ChevronLeft className={CARET_ICON} aria-hidden />
          ) : (
            <ChevronRight className={CARET_ICON} aria-hidden />
          )}
        </button>
      )}
      </div>
    </div>
  );
}

/**
 * The Dictation Bar as Settings shows it beside a size choice: the same parts
 * and classes, idle with Auto picked, drawn in place instead of fixed. Static
 * markup, so nothing inside takes focus or adds to the choice's name.
 */
export function DictationBarPreview({ size }: { size: BarLayout }) {
  const L = LAYOUT[size];
  return (
    <span
      data-dictation-bar-preview=""
      aria-hidden="true"
      className="pointer-events-none inline-flex"
    >
      <span data-bar-part="frame" className={`${FRAME_CLASS} ${L.frame}`}>
        <span data-bar-part="mic" className={buttonClass(size)}>
          <Mic className={L.icon} aria-hidden />
        </span>
        <span data-bar-part="language" className={L.language}>
          <span
            className={selectTriggerClassName({
              variant: L.languageVariant,
              minWidth: "none",
              triggerClassName: L.languageTrigger,
            })}
          >
            {size === "compact" ? (
              <>
                <span>{AUTO}</span>
                <ChevronIcon className="h-2.5 w-2.5" />
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate">{AUTO}</span>
                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                  <ChevronIcon className="h-4 w-4 text-muted-foreground" />
                </span>
              </>
            )}
          </span>
        </span>
        <span data-bar-part="settings" className={buttonClass(size)}>
          <Settings2 className={L.icon} aria-hidden />
        </span>
        <span data-bar-part="collapse" className={COLLAPSE_CLASS}>
          <ChevronRight className={CARET_ICON} aria-hidden />
        </span>
      </span>
    </span>
  );
}
