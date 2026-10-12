import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { PluginPermissionDialog } from "@/components/plugins/PluginPermissionDialog";
import { PluginSurface } from "@/components/plugins/PluginSurface";
import { PluginRow } from "@/components/settings/PluginRow";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsSection, SETTINGS_ROW_CLASS } from "@/components/settings/SettingsSection";
import { usePluginManagementStore } from "@/features/plugins/management";
import type { PluginManagementEntry, PluginPermissionId } from "@/features/plugins/types";
import { useSettingsRevealStore } from "@/features/settings/settings-reveal-store";
import {
  currentSettingsPlatform,
  getPluginSettingsOwners,
  getPluginSettingsRows,
  onSettingsRowsChange,
  rowOnPlatform,
} from "@/features/settings/rows";
import { useShortcuts } from "@/lib/shortcuts";

/**
 * The Plugins Settings section: one row per known Plugin, from the management
 * store, ordered by name, then any Plugin that only declares Settings rows.
 * A row carries its origin and state badges, its startup error, and — expanded
 * — its Plugin Permissions and the enable/disable action. With no known Plugin
 * it shows its empty state.
 */
export function PluginsSection() {
  const { t } = useTranslation();
  const plugins = usePluginManagementStore((state) => state.plugins);
  const owners = useSyncExternalStore(
    onSettingsRowsChange,
    getPluginSettingsOwners,
    getPluginSettingsOwners
  );
  const pluginOpen = useSettingsRevealStore((state) => state.pluginOpen);
  const setPluginOpen = useSettingsRevealStore((state) => state.setPluginOpen);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const platform = currentSettingsPlatform();

  // The section is the one reader of the Plugin Directory the author reaches:
  // refresh on mount so a copy that changed elsewhere shows its state here.
  useEffect(() => {
    void usePluginManagementStore
      .getState()
      .refresh()
      .catch(() => {});
  }, []);

  const entries = Object.values(plugins).sort((a, b) =>
    a.manifest.name.localeCompare(b.manifest.name)
  );
  const known = new Set(entries.map((entry) => entry.pluginId));
  const legacyOwners = owners.filter((owner) => !known.has(owner.pluginId));

  const reviewable = entries.filter(
    (entry) => entry.review.status !== "approved" || hasMissingRequired(entry)
  );
  useShortcuts([
    {
      id: "settings.reviewPlugin",
      enabled: reviewable.length > 0,
      onTrigger: () => {
        const first = reviewable[0];
        if (first) setReviewingId(first.pluginId);
      },
    },
  ]);

  const reviewing = reviewingId !== null ? (plugins[reviewingId] ?? null) : null;

  return (
    <SettingsSection
      sectionId="plugins"
      title={t("settings.plugins")}
      description={t("settings.pluginsDescription")}
    >
      {entries.length === 0 && legacyOwners.length === 0 ? (
        <div className={SETTINGS_ROW_CLASS}>
          <div>
            <p className="font-medium">{t("settings.pluginsEmpty")}</p>
            <p className="text-sm text-muted-foreground">{t("settings.pluginsEmptyDescription")}</p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {entries.map((entry) => (
            <PluginRow
              key={entry.pluginId}
              entry={entry}
              open={pluginOpen[entry.pluginId] ?? false}
              onToggle={() => setPluginOpen(entry.pluginId, !(pluginOpen[entry.pluginId] ?? false))}
              onReview={() => setReviewingId(entry.pluginId)}
              platform={platform}
            />
          ))}
          {legacyOwners.map((owner) => {
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
                    <PluginSurface pluginId={owner.pluginId} surface="settings" />
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

      <PluginPermissionDialog
        isOpen={reviewing !== null}
        manifest={reviewing?.manifest ?? null}
        onClose={() => setReviewingId(null)}
        onApprove={(optionalGranted) => {
          const pluginId = reviewingId;
          setReviewingId(null);
          if (pluginId !== null) {
            void usePluginManagementStore.getState().approve(pluginId, optionalGranted);
          }
        }}
      />
    </SettingsSection>
  );
}

/** True when an approved copy no longer grants one of its required permissions. */
function hasMissingRequired(entry: PluginManagementEntry): boolean {
  if (entry.approval === null) return false;
  return entry.manifest.permissions.required.some(
    (permission) => !entry.approval?.granted.includes(permission as PluginPermissionId)
  );
}
