import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/features/settings";
import { Switch } from "@/components/ui";
import {
  IS_DESKTOP,
  getResourceUsageSummary,
  isMac,
  onResourceUsageSummary,
  type ResourceUsageSummary,
} from "@/lib/platform";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsSection, SETTINGS_ROW_CLASS } from "@/components/settings/SettingsSection";

export function WindowSection() {
  const { t } = useTranslation();
  const {
    launchOnStartup,
    closeToTray,
    trayResourceUsage,
    setLaunchOnStartup,
    setCloseToTray,
    setTrayResourceUsage,
  } = useSettings();

  if (!IS_DESKTOP || isMac()) return null;

  return (
    <SettingsSection
      sectionId="window"
      title={t("settings.window")}
      data-tutorial="settings.window"
    >
      <SettingRow id="launchOnStartup" className={SETTINGS_ROW_CLASS}>
        <Switch
          checked={launchOnStartup}
          onChange={setLaunchOnStartup}
          label={t("settings.launchOnStartup")}
        />
      </SettingRow>

      <SettingRow id="closeToTray" className={SETTINGS_ROW_CLASS}>
        <Switch checked={closeToTray} onChange={setCloseToTray} label={t("settings.closeToTray")} />
      </SettingRow>

      <SettingRow
        id="trayResourceUsage"
        className={SETTINGS_ROW_CLASS}
        labelExtra={trayResourceUsage ? <ResourceUsageLine /> : null}
      >
        <Switch
          checked={trayResourceUsage}
          onChange={setTrayResourceUsage}
          label={t("settings.trayResourceUsage")}
        />
      </SettingRow>
    </SettingsSection>
  );
}

// The tray's CPU, RAM, and storage total, as Rust words and pushes them. Not
// a live region: it changes every 2 s and would talk over everything else.
function ResourceUsageLine() {
  const [summary, setSummary] = useState<ResourceUsageSummary | null>(null);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    // Listen first: a push that lands while the first read is in flight
    // must not be lost to it.
    void onResourceUsageSummary((next) => {
      if (active) setSummary(next);
    })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
        return getResourceUsageSummary();
      })
      .then((current) => {
        if (active && current) setSummary((shown) => shown ?? current);
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  if (!summary) return null;
  return (
    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
      {[summary.cpu, summary.ram, summary.storage].join(" · ")}
    </p>
  );
}
