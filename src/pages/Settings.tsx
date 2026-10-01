import { useEffect, useRef, type ComponentType } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/features/settings";
import { AsciiFieldBackground } from "@/components/settings/AsciiFieldBackground";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { WindowSection } from "@/components/settings/WindowSection";
import { GeneralSection } from "@/components/settings/GeneralSection";
import { ShortcutsSection } from "@/components/settings/ShortcutsSection";
import { SyncSection } from "@/components/settings/SyncSection";
import { BackupsSection } from "@/components/settings/BackupsSection";
import { MetricsSettingsSection } from "@/components/settings/MetricsSettingsSection";
import { EditorSection } from "@/components/settings/EditorSection";
import { DictationSettingsSection } from "@/components/settings/DictationSettingsSection";
import { ExportSection } from "@/components/settings/ExportSection";
import { TutorialSection } from "@/components/settings/TutorialSection";
import { AdvancedSection } from "@/components/settings/AdvancedSection";
import { AboutSection } from "@/components/settings/AboutSection";
import { SETTINGS_SECTIONS, findSettingsRow } from "@/components/settings/settings-sections";
import { useSettingsRevealStore } from "@/features/settings/settings-reveal-store";
// PROTOTYPE: side navigation variants (branch prototype-settings-toc).
import { PrototypeSwitcher } from "@/components/prototype/PrototypeSwitcher";
import {
  SETTINGS_NAV_VARIANTS,
  VariantA,
  VariantB,
  VariantC,
} from "@/components/settings/SettingsNav.prototype";
import { VariantD } from "@/components/settings/SettingsOutline.prototype";

const NAV_VARIANTS = { A: VariantA, B: VariantB, C: VariantC, D: VariantD };

const SECTION_COMPONENTS = {
  appearance: AppearanceSection,
  window: WindowSection,
  general: GeneralSection,
  shortcuts: ShortcutsSection,
  sync: SyncSection,
  backups: BackupsSection,
  metrics: MetricsSettingsSection,
  editor: EditorSection,
  dictation: DictationSettingsSection,
  export: ExportSection,
  tutorial: TutorialSection,
  advanced: AdvancedSection,
  about: AboutSection,
} satisfies Record<(typeof SETTINGS_SECTIONS)[number]["id"], ComponentType>;

const FOCUSABLE_IN_ROW =
  'button:not([disabled]), input:not([disabled]), select, textarea, [role="switch"], [role="slider"], [tabindex]:not([tabindex="-1"])';

function usePendingSettingsRow() {
  const pendingRowId = useSettingsRevealStore((state) => state.pendingRowId);

  useEffect(() => {
    if (!pendingRowId) return;
    const found = findSettingsRow(pendingRowId);
    if (!found) {
      useSettingsRevealStore.getState().clearRow();
      return;
    }
    const { section, row } = found;
    if (row.reveal?.kind === "advanced") {
      useSettingsRevealStore.getState().setAdvancedOpen(true);
    } else if (row.reveal?.kind === "pasteCleanupAdvanced") {
      useSettingsRevealStore.getState().setPasteCleanupAdvancedOpen(true);
    }
    // A dictationLanguage reveal needs nothing: the rows live in the tabs'
    // selected panel, which is already mounted.

    let attempts = 0;
    let frame = 0;
    const tryFocus = () => {
      attempts += 1;
      const rowElement = document.querySelector(`[data-settings-row="${pendingRowId}"]`);
      if (rowElement) {
        // jsdom has no layout; the call is a no-op guard there.
        rowElement.scrollIntoView?.({ block: "center" });
        rowElement.querySelector<HTMLElement>(FOCUSABLE_IN_ROW)?.focus();
        useSettingsRevealStore.getState().clearRow();
        return;
      }
      if (attempts >= 10) {
        // The row is state-dependent (e.g. a logged-out sync row) and never
        // mounted: fall back to its section's heading.
        document.querySelector<HTMLElement>(`[data-settings-section="${section.id}"]`)?.focus();
        useSettingsRevealStore.getState().clearRow();
        return;
      }
      frame = requestAnimationFrame(tryFocus);
    };
    frame = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(frame);
  }, [pendingRowId]);
}

// Its own component so a request re-renders this null child, not every
// Settings section, before the first focus attempt.
function PendingSettingsRow() {
  usePendingSettingsRow();
  return null;
}

export function Settings() {
  const { t } = useTranslation();
  const location = useLocation();
  const { primaryColor } = useSettings();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();
  const variantKey = (searchParams.get("variant") ?? "D") as keyof typeof NAV_VARIANTS;
  const NavVariant = NAV_VARIANTS[variantKey] ?? VariantD;

  // A control elsewhere links to Settings → Dictation by hash; scroll to it.
  // Two frames wait for the section to be in the DOM; location.key re-scrolls
  // on a repeated navigation to the same hash.
  useEffect(() => {
    if (location.hash !== "#dictation") return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById("dictation")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });
  }, [location.hash, location.key]);

  return (
    <div ref={scrollerRef} className="h-full overflow-auto relative @container">
      <PendingSettingsRow />
      <AsciiFieldBackground color={primaryColor} />
      <NavVariant key={variantKey} scrollerRef={scrollerRef}>
        <div className="relative z-10 p-4 sm:p-8 w-full max-w-2xl bg-background @container">
          <h1 data-route-heading className="text-xl @lg:text-2xl font-semibold mb-6 @lg:mb-8">
            {t("settings.title")}
          </h1>

          {SETTINGS_SECTIONS.map((section) => {
            const Section = SECTION_COMPONENTS[section.id];
            return <Section key={section.id} />;
          })}
        </div>
      </NavVariant>
      <PrototypeSwitcher variants={SETTINGS_NAV_VARIANTS} current={variantKey} />
    </div>
  );
}
