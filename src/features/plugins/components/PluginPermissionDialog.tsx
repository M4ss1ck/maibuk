/**
 * PluginPermissionDialog Component
 *
 * Modal dialog for reviewing and granting permissions to a plugin.
 * Shows permission details and risk levels before enabling.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { InstalledPlugin } from "../types";
import { PERMISSION_INFO } from "../types";
import { usePluginStore } from "../store";
import { Button, Modal } from "../../../components/ui";
import { getPluginManager } from "../core/PluginManager";

interface PluginPermissionDialogProps {
  plugin: InstalledPlugin | null;
  isOpen: boolean;
  onClose: () => void;
}

export function PluginPermissionDialog({
  plugin,
  isOpen,
  onClose,
}: PluginPermissionDialogProps) {
  const { t } = useTranslation();
  const [isGranting, setIsGranting] = useState(false);

  const { grantAllRequiredPermissions, enablePlugin } = usePluginStore();

  if (!plugin) return null;

  const { manifest, grantedPermissions } = plugin;
  const requiredPermissions = manifest.permissions;
  const missingPermissions = requiredPermissions.filter(
    (p) => !grantedPermissions.includes(p)
  );

  const highRiskPermissions = missingPermissions.filter(
    (p) => PERMISSION_INFO[p].risk === "high"
  );

  const handleGrantAll = async () => {
    setIsGranting(true);
    try {
      grantAllRequiredPermissions(manifest.id);
      enablePlugin(manifest.id);

      // Get the updated plugin from the store after enabling
      const updatedPlugin = usePluginStore.getState().getPlugin(manifest.id);
      if (updatedPlugin) {
        const manager = getPluginManager();
        await manager.loadPlugin(updatedPlugin);
      }

      onClose();
    } finally {
      setIsGranting(false);
    }
  };

  const getRiskBadgeClass = (risk: "low" | "medium" | "high") => {
    switch (risk) {
      case "low":
        return "bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30";
      case "medium":
        return "bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30";
      case "high":
        return "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30";
    }
  };

  const getRiskLabel = (risk: "low" | "medium" | "high") => {
    switch (risk) {
      case "low":
        return t("plugins.riskLow");
      case "medium":
        return t("plugins.riskMedium");
      case "high":
        return t("plugins.riskHigh");
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("plugins.permissionsTitle")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleGrantAll} disabled={isGranting}>
            {isGranting ? t("common.loading") : t("plugins.grantAndEnable")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Plugin Info */}
        <div className="p-3 bg-muted rounded-lg">
          <h4 className="font-medium">{manifest.name}</h4>
          <p className="text-sm text-muted-foreground mt-1">
            {manifest.description}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("common.by")} {manifest.author.name} &bull; v{manifest.version}
          </p>
        </div>

        {/* Warning for high-risk permissions */}
        {highRiskPermissions.length > 0 && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-sm text-red-600 dark:text-red-400">
              {t("plugins.highRiskWarning")}
            </p>
          </div>
        )}

        {/* Permission List */}
        <div>
          <h5 className="text-sm font-medium mb-3">
            {t("plugins.requestedPermissions")}
          </h5>
          <div className="space-y-2">
            {requiredPermissions.map((permission) => {
              const info = PERMISSION_INFO[permission];
              const isGranted = grantedPermissions.includes(permission);
              const isMissing = missingPermissions.includes(permission);

              return (
                <div
                  key={permission}
                  className={`p-3 rounded-lg border ${
                    isGranted
                      ? "bg-muted/50 border-border"
                      : getRiskBadgeClass(info.risk)
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{info.label}</span>
                        {isMissing && (
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${getRiskBadgeClass(
                              info.risk
                            )}`}
                          >
                            {getRiskLabel(info.risk)}
                          </span>
                        )}
                        {isGranted && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-600 dark:text-green-400">
                            {t("plugins.granted")}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {info.description}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-xs text-muted-foreground">
          {t("plugins.permissionDisclaimer")}
        </p>
      </div>
    </Modal>
  );
}
