/**
 * PluginSettings Component
 *
 * Main plugin management section for the Settings page.
 * Shows installed plugins, allows installation, and manages permissions.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { InstalledPlugin, PluginManifest } from "../types";
import { usePluginStore } from "../store";
import { Button } from "../../../components/ui";
import { PluginCard } from "./PluginCard";
import { PluginInstallDialog } from "./PluginInstallDialog";
import { PluginPermissionDialog } from "./PluginPermissionDialog";

export function PluginSettings() {
  const { t } = useTranslation();
  const { plugins } = usePluginStore();

  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [permissionPlugin, setPermissionPlugin] = useState<InstalledPlugin | null>(
    null
  );

  const installedPlugins = Object.values(plugins);
  const enabledCount = installedPlugins.filter((p) => p.enabled).length;

  const handleInstalled = (manifest: PluginManifest) => {
    // After installation, show permission dialog for the new plugin
    const newPlugin = plugins[manifest.id];
    if (newPlugin) {
      setPermissionPlugin(newPlugin);
    }
  };

  const handleRequestPermissions = (plugin: InstalledPlugin) => {
    setPermissionPlugin(plugin);
  };

  return (
    <section className="mb-6 sm:mb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-medium">{t("plugins.title")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("plugins.subtitle", {
              total: installedPlugins.length,
              enabled: enabledCount,
            })}
          </p>
        </div>
        <Button onClick={() => setShowInstallDialog(true)}>
          {t("plugins.installPlugin")}
        </Button>
      </div>

      {/* Plugin List */}
      {installedPlugins.length > 0 ? (
        <div className="space-y-3">
          {installedPlugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              onRequestPermissions={handleRequestPermissions}
            />
          ))}
        </div>
      ) : (
        <div className="border border-dashed border-border rounded-lg p-8 text-center">
          <div className="text-4xl mb-3">🧩</div>
          <p className="text-muted-foreground">{t("plugins.noPlugins")}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {t("plugins.noPluginsHint")}
          </p>
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() => setShowInstallDialog(true)}
          >
            {t("plugins.installFirst")}
          </Button>
        </div>
      )}

      {/* Info about plugins */}
      <div className="mt-4 p-3 bg-muted rounded-lg">
        <p className="text-xs text-muted-foreground">
          {t("plugins.securityNote")}
        </p>
      </div>

      {/* Install Dialog */}
      <PluginInstallDialog
        isOpen={showInstallDialog}
        onClose={() => setShowInstallDialog(false)}
        onInstalled={handleInstalled}
      />

      {/* Permission Dialog */}
      <PluginPermissionDialog
        plugin={permissionPlugin}
        isOpen={permissionPlugin !== null}
        onClose={() => setPermissionPlugin(null)}
      />
    </section>
  );
}
