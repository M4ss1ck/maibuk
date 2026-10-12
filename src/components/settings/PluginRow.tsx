/**
 * One Plugin row in Settings (#442): the name, its origin and state badges, a
 * startup error when one is recorded, and — expanded — the Plugin's granted
 * Plugin Permissions with their revoke controls, the enable/disable action,
 * and the Settings rows the Plugin declares.
 *
 * The row reads the management store's entry, so the enable state, review
 * state, and grants all come from one place. A required grant is revocable
 * through "Disable Plugin and revoke access", which turns the Plugin off; an
 * optional grant is revocable on its own and leaves the Plugin enabled.
 */

import { useTranslation } from "react-i18next";
import {
  pluginPermissionCopy,
  type PermissionTranslate,
} from "@/components/plugins/plugin-permission-copy";
import { pluginStartupErrorText } from "@/components/plugins/plugin-startup-error";
import { PluginSurface } from "@/components/plugins/PluginSurface";
import { SettingRow } from "@/components/settings/SettingRow";
import { SETTINGS_ROW_CLASS } from "@/components/settings/SettingsSection";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { usePluginManagementStore } from "@/features/plugins/management";
import type { PluginManagementEntry, PluginPermissionId } from "@/features/plugins/types";
import {
  getPluginSettingsRows,
  rowOnPlatform,
  type SettingsPlatform,
} from "@/features/settings/rows";

const BADGE_CLASS =
  "inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground";

/** True when the copy is approved but a required Plugin Permission is not granted. */
function hasMissingRequired(entry: PluginManagementEntry): boolean {
  if (entry.approval === null) return false;
  return entry.manifest.permissions.required.some(
    (permission) => !entry.approval?.granted.includes(permission as PluginPermissionId)
  );
}

interface PluginRowProps {
  entry: PluginManagementEntry;
  open: boolean;
  onToggle: () => void;
  /** Opens the permission approval or changed-files review dialog for this Plugin. */
  onReview: () => void;
  /** Opens the replace-confirmation dialog for a modified Built-in copy. */
  onReplace: () => void;
  platform: SettingsPlatform;
}

export function PluginRow({ entry, open, onToggle, onReview, onReplace, platform }: PluginRowProps) {
  const { t } = useTranslation();
  const translate = t as unknown as PermissionTranslate;
  const store = usePluginManagementStore.getState();
  const manifest = entry.manifest;
  const approval = entry.approval;
  const required = manifest.permissions.required;
  const optional = manifest.permissions.optional;
  const requiredMissing = hasMissingRequired(entry);
  const needsApproval = entry.review.status !== "approved" || requiredMissing;
  const enabled = approval?.enabled === true;
  const rows = getPluginSettingsRows(entry.pluginId).filter((row) => rowOnPlatform(row, platform));
  const declared = [...required, ...optional.filter((permission) => !required.includes(permission))];
  const optionalGranted =
    approval?.granted.filter((permission) => optional.includes(permission)) ?? [];

  return (
    <div className="py-2">
      <div className="flex w-full items-center justify-between gap-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`plugin-accordion-${entry.pluginId}`}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded py-2 text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="truncate">{manifest.name}</span>
          <span aria-hidden="true" className="text-muted-foreground">
            {open ? "−" : "+"}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {entry.builtIn && <span className={BADGE_CLASS}>{t("plugins.builtInBadge")}</span>}
          {entry.modified && <span className={BADGE_CLASS}>{t("plugins.modified")}</span>}
          {entry.updateAvailable && <span className={BADGE_CLASS}>{t("plugins.available")}</span>}
          {entry.review.status === "review-required" && (
            <span className={BADGE_CLASS}>{t("plugins.reviewRequired")}</span>
          )}
          <span className={BADGE_CLASS}>
            {enabled ? t("plugins.status.enabled") : t("plugins.status.off")}
          </span>
        </div>
      </div>

      {approval?.startupError !== undefined && (
        <p className="mt-1 text-sm text-destructive">
          {pluginStartupErrorText(approval.startupError, translate)}
        </p>
      )}

      {open && (
        <div id={`plugin-accordion-${entry.pluginId}`}>
          <div className="mt-2 flex flex-wrap gap-2">
            {enabled ? (
              <Button variant="secondary" onClick={() => store.disable(entry.pluginId)}>
                {t("plugins.disable")}
              </Button>
            ) : needsApproval ? (
              <Button onClick={onReview} data-command="settings.reviewPlugin">
                {t("plugins.reviewEnable")}
              </Button>
            ) : (
              <Button onClick={() => void store.enable(entry.pluginId)}>
                {t("plugins.enable")}
              </Button>
            )}
          </div>

          {entry.updateAvailable && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                data-command="settings.keepMyCopy"
                onClick={() => void store.keepMyCopy(entry.pluginId)}
              >
                {t("plugins.keep")}
              </Button>
              <Button variant="secondary" data-command="settings.replaceBuiltIn" onClick={onReplace}>
                {t("plugins.replace")}
              </Button>
            </div>
          )}

          {approval !== null && (
            <div className="mt-3">
              <h3 className="text-sm font-medium">{t("plugins.permissions.grantTitle")}</h3>
              {declared.map((permission) => {
                const isRequired = required.includes(permission);
                const granted = approval.granted.includes(permission as PluginPermissionId);
                const copy = pluginPermissionCopy(permission, translate);
                const label = `${copy.title} · ${t(
                  isRequired ? "plugins.permissions.requiredLabel" : "plugins.permissions.optionalLabel"
                )}`;
                return (
                  <div key={permission} className="border-b border-border py-2 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Checkbox
                        checked={granted}
                        disabled={isRequired}
                        label={label}
                        onChange={(next) => {
                          if (isRequired) return;
                          if (next) {
                            void store.approve(entry.pluginId, [
                              ...optionalGranted,
                              permission as PluginPermissionId,
                            ]);
                          } else {
                            void store.revoke(entry.pluginId, permission as PluginPermissionId);
                          }
                        }}
                      />
                      <span className="font-medium">{label}</span>
                      {isRequired && granted && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() =>
                            void store.revoke(entry.pluginId, permission as PluginPermissionId)
                          }
                        >
                          {t("plugins.permissions.revokeRequired")}
                        </Button>
                      )}
                    </div>
                    {isRequired && !granted ? (
                      <p className="mt-1 pl-6 text-sm text-destructive">
                        {t("plugins.permissions.requiredMissing")}
                      </p>
                    ) : (
                      <p className="mt-1 pl-6 text-sm text-muted-foreground">{copy.detail}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <PluginSurface pluginId={entry.pluginId} surface="settings" />
          {rows.map((row) => (
            <SettingRow key={row.id} id={row.id} className={SETTINGS_ROW_CLASS}>
              {/* Placeholder field until the remote-UI host renders the row's
                  live controls (#437). A field needs no Command; it exists so
                  search and reveal already focus a row. */}
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
}
