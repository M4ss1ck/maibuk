/**
 * PluginCard Component
 *
 * Displays an individual installed plugin with controls for
 * enabling/disabling, permissions, and uninstalling.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { InstalledPlugin } from "../types";
import { PERMISSION_INFO } from "../types";
import { usePluginStore } from "../store";
import { Button, Switch, Modal } from "../../../components/ui";
import { getPluginManager } from "../core/PluginManager";

interface PluginCardProps {
  plugin: InstalledPlugin;
  onRequestPermissions: (plugin: InstalledPlugin) => void;
}

export function PluginCard({ plugin, onRequestPermissions }: PluginCardProps) {
  const { t } = useTranslation();
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const { enablePlugin, disablePlugin, uninstallPlugin } = usePluginStore();

  const { manifest, enabled, grantedPermissions } = plugin;

  // Check if all required permissions are granted
  const missingPermissions = manifest.permissions.filter(
    (p) => !grantedPermissions.includes(p)
  );
  const canEnable = missingPermissions.length === 0;

  const handleToggleEnabled = async () => {
    if (enabled) {
      // Disable plugin
      const manager = getPluginManager();
      await manager.unloadPlugin(manifest.id);
      disablePlugin(manifest.id);
    } else if (canEnable) {
      // Enable plugin
      enablePlugin(manifest.id);
      // Get the updated plugin from the store after enabling
      const updatedPlugin = usePluginStore.getState().getPlugin(manifest.id);
      if (updatedPlugin) {
        const manager = getPluginManager();
        await manager.loadPlugin(updatedPlugin);
      }
    } else {
      // Need permissions first
      onRequestPermissions(plugin);
    }
  };

  const handleUninstall = async () => {
    setIsUninstalling(true);
    try {
      const manager = getPluginManager();
      await manager.unloadPlugin(manifest.id);
      await uninstallPlugin(manifest.id);
    } finally {
      setIsUninstalling(false);
      setShowUninstallConfirm(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  const getRiskBadgeClass = (risk: "low" | "medium" | "high") => {
    switch (risk) {
      case "low":
        return "bg-green-500/20 text-green-600 dark:text-green-400";
      case "medium":
        return "bg-amber-500/20 text-amber-600 dark:text-amber-400";
      case "high":
        return "bg-red-500/20 text-red-600 dark:text-red-400";
    }
  };

  return (
    <>
      <div className="border border-border rounded-lg p-4 bg-card">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-foreground truncate">
                {manifest.name}
              </h4>
              <span className="text-xs text-muted-foreground">
                v{manifest.version}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
              {manifest.description}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {t("common.by")} {manifest.author.name}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!canEnable && !enabled && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onRequestPermissions(plugin)}
              >
                {t("plugins.grantPermissions") as string}
              </Button>
            )}
            <div className={!canEnable && !enabled ? "opacity-50 pointer-events-none" : ""}>
              <Switch
                checked={enabled}
                onChange={handleToggleEnabled}
                label={(enabled ? t("plugins.enabled") : t("plugins.disabled")) as string}
              />
            </div>
          </div>
        </div>

        {/* Quick Info */}
        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          <span>{t("plugins.type")}: {manifest.type}</span>
          <span>{t("plugins.installed")}: {formatDate(plugin.installedAt)}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {showDetails ? t("plugins.hideDetails") : t("plugins.showDetails")}
          </button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowUninstallConfirm(true)}
            className="text-destructive hover:text-destructive"
          >
            {t("plugins.uninstall")}
          </Button>
        </div>

        {/* Expanded Details */}
        {showDetails && (
          <div className="mt-4 pt-3 border-t border-border space-y-3">
            {/* Permissions */}
            <div>
              <h5 className="text-sm font-medium mb-2">{t("plugins.permissions")}</h5>
              <div className="flex flex-wrap gap-2">
                {manifest.permissions.map((permission) => {
                  const info = PERMISSION_INFO[permission];
                  const isGranted = grantedPermissions.includes(permission);
                  return (
                    <span
                      key={permission}
                      className={`text-xs px-2 py-1 rounded-full ${
                        isGranted
                          ? getRiskBadgeClass(info.risk)
                          : "bg-muted text-muted-foreground"
                      }`}
                      title={info.description}
                    >
                      {info.label}
                      {!isGranted && " (!)"}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Metadata */}
            <div className="text-xs text-muted-foreground space-y-1">
              <p>ID: {manifest.id}</p>
              {manifest.homepage && (
                <p>
                  Homepage:{" "}
                  <a
                    href={manifest.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {manifest.homepage}
                  </a>
                </p>
              )}
              {manifest.license && <p>License: {manifest.license}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Uninstall Confirmation Modal */}
      <Modal
        isOpen={showUninstallConfirm}
        onClose={() => setShowUninstallConfirm(false)}
        title={t("plugins.uninstallTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowUninstallConfirm(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleUninstall}
              disabled={isUninstalling}
            >
              {isUninstalling ? t("common.loading") : t("plugins.confirmUninstall")}
            </Button>
          </>
        }
      >
        <p className="text-muted-foreground">
          {t("plugins.uninstallConfirmMessage", { name: manifest.name })}
        </p>
      </Modal>
    </>
  );
}
