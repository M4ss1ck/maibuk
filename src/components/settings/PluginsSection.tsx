import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsSection, SETTINGS_ROW_CLASS } from "@/components/settings/SettingsSection";
import { useSettingsRevealStore } from "@/features/settings/settings-reveal-store";
import {
  currentSettingsPlatform,
  getPluginSettingsOwners,
  getPluginSettingsRows,
  onSettingsRowsChange,
  rowOnPlatform,
} from "@/features/settings/rows";

/**
 * The Plugins Settings section: one accordion per Plugin that declares
 * Settings rows, ordered Maibuk first, then owner display name, owner id for
 * ties, declared order within. With no known Plugin it shows its empty state.
 * Live controls arrive with the wiring slice (#437); each row renders a
 * placeholder field meanwhile so search and reveal already work end to end.
 */
export function PluginsSection() {
  const { t } = useTranslation();
  const owners = useSyncExternalStore(
    onSettingsRowsChange,
    getPluginSettingsOwners,
    getPluginSettingsOwners
  );
  const pluginOpen = useSettingsRevealStore((state) => state.pluginOpen);
  const setPluginOpen = useSettingsRevealStore((state) => state.setPluginOpen);

  const platform = currentSettingsPlatform();

  return (
    <SettingsSection
      sectionId="plugins"
      title={t("settings.plugins")}
      description={t("settings.pluginsDescription")}
    >
      {owners.length === 0 ? (
        <div className={SETTINGS_ROW_CLASS}>
          <div>
            <p className="font-medium">{t("settings.pluginsEmpty")}</p>
            <p className="text-sm text-muted-foreground">{t("settings.pluginsEmptyDescription")}</p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {owners.map((owner) => {
            const rows = getPluginSettingsRows(owner.pluginId).filter((row) =>
              rowOnPlatform(row, platform)
            );
            if (rows.length === 0) return null;
            const open = pluginOpen[owner.pluginId] ?? false;
            return (
              <div key={owner.pluginId} className="py-2">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`plugin-accordion-${owner.pluginId}`}
                  onClick={() => setPluginOpen(owner.pluginId, !open)}
                  className="flex w-full items-center justify-between rounded py-2 text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span>{owner.displayName}</span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    {open ? "−" : "+"}
                  </span>
                </button>
                {open && (
                  <div id={`plugin-accordion-${owner.pluginId}`}>
                    {rows.map((row) => (
                      <SettingRow key={row.id} id={row.id} className={SETTINGS_ROW_CLASS}>
                        {/* Placeholder field until the remote-UI host renders the
                            row's live controls (#437). A field needs no Command;
                            it exists so search and reveal already focus a row. */}
                        <input
                          type="text"
                          aria-label={row.label}
                          placeholder={row.label}
                          defaultValue=""
                          className="w-full max-w-xs rounded border border-border bg-background px-2 py-1 text-sm"
                        />
                      </SettingRow>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SettingsSection>
  );
}
