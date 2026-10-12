import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { PluginPermissionDialog } from "@/components/plugins/PluginPermissionDialog";
import { PluginReviewDialog } from "@/components/plugins/PluginReviewDialog";
import { PluginSurface } from "@/components/plugins/PluginSurface";
import { ReplaceBuiltInDialog } from "@/components/plugins/ReplaceBuiltInDialog";
import { PluginRow } from "@/components/settings/PluginRow";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsSection, SETTINGS_ROW_CLASS } from "@/components/settings/SettingsSection";
import { Button, Switch } from "@/components/ui";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { toast } from "@/components/ui/Toast";
import { hasMissingRequired } from "@/features/plugins/approvals";
import {
  PLUGIN_FILTER_CATEGORIES,
  type PluginFilterCategory,
  countPluginsByCategory,
  filterPluginsByCategories,
  usePluginManagementStore,
} from "@/features/plugins/management";
import type { PluginManagementEntry } from "@/features/plugins/types";
import { useSettingsRevealStore } from "@/features/settings/settings-reveal-store";
import { useSettingsStore } from "@/features/settings/store";
import {
  currentSettingsPlatform,
  getPluginSettingsOwners,
  getPluginSettingsRows,
  onSettingsRowsChange,
  rowOnPlatform,
} from "@/features/settings/rows";
import { getPluginDirectory } from "@/lib/platform";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
import { useShortcuts } from "@/lib/shortcuts";

/**
 * The Plugins Settings section: the Plugin Directory header (Add Plugin on
 * every platform, the desktop Open / Change Plugin Directory actions, the
 * folder picker where supported, and the platform explanation), a multi-select
 * status filter over the known Plugins, a Development mode switch, then one row
 * per known Plugin, from the management store, ordered by name, then any Plugin
 * that only declares Settings rows. A row carries its origin and state badges,
 * its startup error, and — expanded — its Plugin Permissions, the
 * enable/disable action, the Built-in Keep my copy / Replace actions, and the
 * Settings rows the Plugin declares. With no known Plugin it shows its empty
 * state; a filter matching nothing shows the empty-result copy.
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
  // The Plugin Directory adapter, read the way the store reads it, so the
  // header can offer the desktop actions and the folder picker only where the
  // platform actually exposes them (#443). Filter selections are session state:
  // every category starts selected, like the Books filter.
  const [directory, setDirectory] = useState<PluginDirectoryAdapter | null>(null);
  const [selected, setSelected] = useState<PluginFilterCategory[]>([...PLUGIN_FILTER_CATEGORIES]);

  const platform = currentSettingsPlatform();
  const isDesktop = platform === "desktop";
  const canAddFromFolder =
    isDesktop || (platform === "web" && directory?.supportsFolderPicker === true);
  const translate = t as unknown as (key: string, options?: Record<string, unknown>) => string;

  // The section is the one reader of the Plugin Directory the author reaches:
  // refresh on mount so a copy that changed elsewhere shows its state here.
  useEffect(() => {
    void usePluginManagementStore
      .getState()
      .refresh()
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const adapter = await getPluginDirectory();
        if (active) setDirectory(adapter);
      } catch {
        // No Plugin Directory is reachable on this build; the header shows the
        // Add Plugin button and the platform explanation alone.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const entries = Object.values(plugins).sort((a, b) =>
    a.manifest.name.localeCompare(b.manifest.name)
  );
  const known = new Set(entries.map((entry) => entry.pluginId));
  const legacyOwners = owners.filter((owner) => !known.has(owner.pluginId));

  const counts = countPluginsByCategory(entries);
  const visible = filterPluginsByCategories(entries, selected);
  const filterOptions = useMemo(
    () =>
      PLUGIN_FILTER_CATEGORIES.map((category) => ({
        id: category,
        label: (t as unknown as (key: string) => string)(`plugins.management.filters.${category}`),
      })),
    [t]
  );

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

  /**
   * Opens the approval flow for a Plugin an add just installed. The store
   * refreshes the entry first, so the copy is known here; a cancelled picker
   * (null) opens nothing (#443).
   */
  const openAddedPlugin = useCallback(
    (pluginId: string | null) => {
      if (pluginId === null) return;
      const entry = usePluginManagementStore.getState().plugins[pluginId];
      if (entry) openReviewFor(entry);
    },
    [openReviewFor]
  );

  const addPlugin = useCallback(async () => {
    try {
      openAddedPlugin(await usePluginManagementStore.getState().addFromZip());
    } catch {
      toast.error(translate("plugins.management.addError"));
    }
  }, [openAddedPlugin, translate]);

  const addFromFolder = useCallback(async () => {
    try {
      openAddedPlugin(await usePluginManagementStore.getState().addFromFolder());
    } catch {
      toast.error(translate("plugins.management.addError"));
    }
  }, [openAddedPlugin, translate]);

  const openDirectory = useCallback(async () => {
    let adapter = directory;
    if (adapter === null) {
      try {
        adapter = await getPluginDirectory();
      } catch {
        adapter = null;
      }
    }
    try {
      await adapter?.openDirectory?.();
    } catch {
      // A missing file manager is not an error.
    }
    await usePluginManagementStore
      .getState()
      .refresh()
      .catch(() => {});
  }, [directory]);

  const changeDirectory = useCallback(async () => {
    let adapter = directory;
    if (adapter === null) {
      try {
        adapter = await getPluginDirectory();
      } catch {
        adapter = null;
      }
    }
    try {
      await adapter?.changeDirectory?.();
    } catch {
      // The author cancelled the picker.
    }
    await usePluginManagementStore
      .getState()
      .refresh()
      .catch(() => {});
  }, [directory]);

  useShortcuts([
    {
      id: "settings.addPlugin",
      onTrigger: () => void addPlugin(),
    },
    {
      id: "settings.openPluginDirectory",
      enabled: isDesktop,
      onTrigger: () => void openDirectory(),
    },
    {
      id: "settings.changePluginDirectory",
      enabled: isDesktop,
      onTrigger: () => void changeDirectory(),
    },
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

      <div data-settings-row="pluginsAdd" className={SETTINGS_ROW_CLASS}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              className="pointer-coarse:min-h-12"
              data-command="settings.addPlugin"
              onClick={() => void addPlugin()}
            >
              {t("plugins.management.add")}
            </Button>
            {isDesktop && (
              <Button
                variant="secondary"
                className="pointer-coarse:min-h-12"
                data-command="settings.openPluginDirectory"
                onClick={() => void openDirectory()}
              >
                {t("plugins.management.open")}
              </Button>
            )}
            {isDesktop && (
              <Button
                variant="secondary"
                className="pointer-coarse:min-h-12"
                data-command="settings.changePluginDirectory"
                onClick={() => void changeDirectory()}
              >
                {t("plugins.management.change")}
              </Button>
            )}
            {canAddFromFolder && (
              <Button
                variant="secondary"
                className="pointer-coarse:min-h-12"
                onClick={() => void addFromFolder()}
              >
                {t("plugins.management.addFolder")}
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {platform === "desktop"
              ? t("plugins.management.directoryDesktop")
              : platform === "android"
                ? t("plugins.management.directoryAndroid")
                : t("plugins.management.directoryWeb")}
          </p>
        </div>
      </div>

      {entries.length > 0 && (
        <div data-settings-row="pluginsFilter" className={SETTINGS_ROW_CLASS}>
          <MultiSelectFilter
            label={t("plugins.management.filters.label")}
            options={filterOptions}
            value={selected}
            counts={counts}
            onChange={setSelected}
            allLabel={t("plugins.management.all")}
            countLabel={(count) => t("plugins.management.filters.count", { count })}
          />
        </div>
      )}

      {entries.length === 0 && legacyOwners.length === 0 ? (
        <div className={SETTINGS_ROW_CLASS}>
          <div>
            <p className="font-medium">{t("settings.pluginsEmpty")}</p>
            <p className="text-sm text-muted-foreground">{t("settings.pluginsEmptyDescription")}</p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {entries.length > 0 && visible.length === 0 && (
            <p className="py-3 text-sm text-muted-foreground">{t("plugins.management.empty")}</p>
          )}
          {visible.map((entry) => (
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
