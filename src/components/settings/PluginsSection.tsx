import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { PluginPermissionDialog } from "@/components/plugins/PluginPermissionDialog";
import { PluginReviewDialog } from "@/components/plugins/PluginReviewDialog";
import { PluginSurface } from "@/components/plugins/PluginSurface";
import { ReplaceBuiltInDialog } from "@/components/plugins/ReplaceBuiltInDialog";
import { PluginRow } from "@/components/settings/PluginRow";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsSection, SETTINGS_ROW_CLASS } from "@/components/settings/SettingsSection";
import { Switch } from "@/components/ui";
import { usePluginManagementStore } from "@/features/plugins/management";
import type { PluginManagementEntry, PluginPermissionId } from "@/features/plugins/types";
import { useSettingsRevealStore } from "@/features/settings/settings-reveal-store";
import { useSettingsStore } from "@/features/settings/store";
import {
  currentSettingsPlatform,
  getPluginSettingsOwners,
  getPluginSettingsRows,
  onSettingsRowsChange,
  rowOnPlatform,
} from "@/features/settings/rows";
import { useShortcuts } from "@/lib/shortcuts";

/**
 * The Plugins Settings section: a Development mode switch, then one row per
 * known Plugin, from the management store, ordered by name, then any Plugin
 * that only declares Settings rows. A row carries its origin and state badges,
 * its startup error, and — expanded — its Plugin Permissions, the
 * enable/disable action, the Built-in Keep my copy / Replace actions, and the
 * Settings rows the Plugin declares. With no known Plugin it shows its empty
 * state.
 */
export function PluginsSection() {
  const { t } = useTranslation();
  const plugins = usePluginManagementStore((state) => state.plugins);
  const pluginDevelopmentMode = useSettingsStore((state) => state.pluginDevelopmentMode);
  const setPluginDevelopmentMode = useSettingsStore((state) => state.setPluginDevelopmentMode);
  const owners = useSyncExternalStore(
    onSettingsRowsChange,
    getPluginSettingsOwners,
    getPluginSettingsOwners
  );
  const pluginOpen = useSettingsRevealStore((state) => state.pluginOpen);
  const setPluginOpen = useSettingsRevealStore((state) => state.setPluginOpen);
  const pendingReviewId = useSettingsRevealStore((state) => state.pendingPluginReviewId);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [diffId, setDiffId] = useState<string | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);

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
  const builtInUpdate = entries.find((entry) => entry.updateAvailable) ?? null;

  /** Opens the review a copy needs: the changed-files diff, or the permission dialog. */
  const openReviewFor = useCallback((entry: PluginManagementEntry) => {
    useSettingsRevealStore.getState().setPluginOpen(entry.pluginId, true);
    if (entry.review.status === "review-required") {
      setDiffId(entry.pluginId);
    } else if (entry.review.status !== "approved" || hasMissingRequired(entry)) {
      setReviewingId(entry.pluginId);
    }
  }, []);

  // The changed-files notice's Review action asks for a Plugin's review here,
  // once the section knows it (the refresh above may still be in flight).
  useEffect(() => {
    if (pendingReviewId === null) return;
    const target = plugins[pendingReviewId];
    if (!target) return;
    useSettingsRevealStore.getState().clearPluginReview();
    openReviewFor(target);
  }, [pendingReviewId, plugins, openReviewFor]);

  useShortcuts([
    {
      id: "settings.reviewPlugin",
      enabled: reviewable.length > 0,
      onTrigger: () => {
        const first = reviewable[0];
        if (first) openReviewFor(first);
      },
    },
    {
      id: "settings.keepMyCopy",
      enabled: builtInUpdate !== null,
      onTrigger: () => {
        if (builtInUpdate) {
          void usePluginManagementStore.getState().keepMyCopy(builtInUpdate.pluginId);
        }
      },
    },
    {
      id: "settings.replaceBuiltIn",
      enabled: builtInUpdate !== null,
      onTrigger: () => {
        if (builtInUpdate) setReplacingId(builtInUpdate.pluginId);
      },
    },
  ]);

  const reviewing = reviewingId !== null ? (plugins[reviewingId] ?? null) : null;
  const diffEntry = diffId !== null ? (plugins[diffId] ?? null) : null;
  const replacing = replacingId !== null ? (plugins[replacingId] ?? null) : null;

  return (
    <SettingsSection
      sectionId="plugins"
      title={t("settings.plugins")}
      description={t("settings.pluginsDescription")}
    >
      <SettingRow id="pluginDevelopmentMode" className={SETTINGS_ROW_CLASS}>
        <Switch
          checked={pluginDevelopmentMode}
          onChange={(next) => {
            // The watcher starts or stops with the setting, so the change is
            // live without a reload (management store, #442).
            setPluginDevelopmentMode(next);
            void usePluginManagementStore
              .getState()
              .refresh()
              .catch(() => {});
          }}
          label={t("plugins.developmentMode")}
        />
      </SettingRow>

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
              onReview={() => openReviewFor(entry)}
              onReplace={() => setReplacingId(entry.pluginId)}
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

      <PluginReviewDialog
        isOpen={diffEntry !== null}
        entry={diffEntry}
        onClose={() => setDiffId(null)}
        onApprove={(optionalGranted) => {
          const pluginId = diffId;
          setDiffId(null);
          if (pluginId !== null) {
            void usePluginManagementStore.getState().markReviewed(pluginId, optionalGranted);
          }
        }}
      />

      {replacing !== null && (
        <ReplaceBuiltInDialog
          isOpen
          name={replacing.manifest.name}
          onClose={() => setReplacingId(null)}
          onConfirm={() => {
            const pluginId = replacingId;
            setReplacingId(null);
            if (pluginId !== null) {
              void usePluginManagementStore.getState().replaceBuiltIn(pluginId, true);
            }
          }}
        />
      )}
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
