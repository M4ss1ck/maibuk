/**
 * One Plugin row in Settings (#442, #443): the name, its origin and state
 * badges, a startup error when one is recorded, and — expanded — the Plugin's
 * stored data size, its custom-UI disclosure, its granted Plugin Permissions
 * with their revoke controls, the enable/disable action, the removal and
 * reinstatement actions, and the Settings rows the Plugin declares.
 *
 * The row reads the management store's entry, so the enable state, review
 * state, and grants all come from one place. A required grant is revocable
 * through "Disable Plugin and revoke access", which turns the Plugin off; an
 * optional grant is revocable on its own and leaves the Plugin enabled. Inline
 * permission toggles stay locked until the copy is approved, so a changed copy
 * is only ever approved through the review dialog.
 *
 * An installed row offers Remove (with the optional data deletion); a removed
 * Built-in offers Reinstall from the bundled copy; a removed row with retained
 * data offers Delete data. Every destructive action confirms in an alert dialog
 * first (#443).
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button as AriaButton, Disclosure, DisclosurePanel } from "react-aria-components";
import { PluginConfirmDialog } from "@/components/plugins/PluginConfirmDialog";
import { PluginPermissionList } from "@/components/plugins/PluginPermissionList";
import { PluginRemoveDialog } from "@/components/plugins/PluginRemoveDialog";
import {
  pluginStartupErrorText,
  type StartupErrorTranslate,
} from "@/components/plugins/plugin-startup-error";
import { PluginSurface } from "@/components/plugins/PluginSurface";
import { SettingRow } from "@/components/settings/SettingRow";
import { SETTINGS_ROW_CLASS } from "@/components/settings/SettingsSection";
import { formatPluginDataSize } from "@/components/settings/plugin-data-size";
import { Button } from "@/components/ui/Button";
import { hasMissingRequired } from "@/features/plugins/approvals";
import { usePluginManagementStore } from "@/features/plugins/management";
import { pluginStopMessageKey } from "@/features/plugins/stop-messages";
import type { PluginManagementEntry, PluginPermissionId } from "@/features/plugins/types";
import {
  getPluginSettingsRows,
  rowOnPlatform,
  type SettingsPlatform,
} from "@/features/settings/rows";

const BADGE_CLASS =
  "inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground";

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
  const { t, i18n } = useTranslation();
  const translate = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  const store = usePluginManagementStore.getState();
  // The data size lives in the store's `dataSizes`, filled by `refreshDataSize`;
  // subscribing here is what re-renders the row when the size arrives.
  const dataSize = usePluginManagementStore((state) => state.dataSizes[entry.pluginId] ?? 0);
  const [removing, setRemoving] = useState(false);
  const [deletingData, setDeletingData] = useState(false);
  const [reinstalling, setReinstalling] = useState(false);
  const manifest = entry.manifest;
  const approval = entry.approval;
  const required = manifest.permissions.required;
  const optional = manifest.permissions.optional;
  const requiredMissing = hasMissingRequired(entry);
  const needsApproval = entry.review.status !== "approved" || requiredMissing;
  const enabled = approval?.enabled === true;
  // Inline permission toggles only change an approved copy; a changed copy goes
  // through the review dialog.
  const reviewApproved = entry.review.status === "approved";
  const rows = getPluginSettingsRows(entry.pluginId).filter((row) => rowOnPlatform(row, platform));
  const declared = [...required, ...optional.filter((permission) => !required.includes(permission))];
  const optionalGranted =
    approval?.granted.filter((permission) => optional.includes(permission)) ?? [];
  // A copy Settings can never enable: its files are gone, two folders claim its
  // id, or its manifest excludes this device (#443). The control stays visible
  // but disabled so the row explains itself instead of acting.
  const enableable = entry.installed && entry.duplicateFolders.length === 0 && !entry.unsupported;
  const stopped = entry.stopped !== null;
  const stoppedKey = entry.stopped !== null ? pluginStopMessageKey(entry.stopped.reason) : null;
  const showCustomUi = manifest.customUi === true;
  // A removed Built-in offers Reinstall from the bundled copy; a removed
  // third-party Plugin offers none (the author must add its files again).
  const canReinstall = !entry.installed && entry.builtIn;
  // A removed row keeps its retained data; when it has any, offer to erase it.
  const canDeleteData = !entry.installed && entry.removed && dataSize > 0;

  // Expanding a row reads the Plugin's stored data size (#443). The action is
  // read off the store rather than the captured `store` so the effect does not
  // re-run on every unrelated state change (the size write included).
  useEffect(() => {
    if (!open) return;
    void Promise.resolve(
      usePluginManagementStore.getState().refreshDataSize(entry.pluginId)
    ).catch(() => {});
  }, [open, entry.pluginId]);

  return (
    <Disclosure isExpanded={open} onExpandedChange={onToggle} className="py-2">
      <div className="flex w-full items-center justify-between gap-3">
        <AriaButton
          slot="trigger"
          className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded py-2 text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="truncate">{manifest.name}</span>
          <span aria-hidden="true" className="text-muted-foreground">
            {open ? "−" : "+"}
          </span>
        </AriaButton>
        <div className="flex shrink-0 items-center gap-2">
          {entry.builtIn && <span className={BADGE_CLASS}>{t("plugins.builtInBadge")}</span>}
          {entry.modified && <span className={BADGE_CLASS}>{t("plugins.modified")}</span>}
          {entry.updateAvailable && <span className={BADGE_CLASS}>{t("plugins.available")}</span>}
          {entry.removed && (
            <span className={BADGE_CLASS}>{t("plugins.management.filters.removed")}</span>
          )}
          {entry.unsupported && (
            <span className={BADGE_CLASS}>{t("plugins.management.filters.unsupported")}</span>
          )}
          {stopped && <span className={BADGE_CLASS}>{t("plugins.management.stopped")}</span>}
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
          {pluginStartupErrorText(approval.startupError, t as unknown as StartupErrorTranslate)}
        </p>
      )}

      <DisclosurePanel>
        {entry.unsupported && (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("plugins.management.unsupportedText")}
          </p>
        )}
        {entry.duplicateFolders.length > 0 && (
          <p className="mt-2 text-sm text-destructive">
            {t("plugins.management.duplicateText", { folders: entry.duplicateFolders.join(", ") })}
          </p>
        )}
        {stopped && stoppedKey !== null && (
          <p className="mt-2 text-sm text-destructive">
            {translate(stoppedKey, { name: manifest.name })}
          </p>
        )}
        {showCustomUi && (
          <p className="mt-2 text-sm text-muted-foreground">{t("plugins.management.custom")}</p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          {t("plugins.management.data")}: <strong>{formatPluginDataSize(dataSize, i18n.language)}</strong>
        </p>

        <div className="mt-2 flex flex-wrap gap-2">
          {!entry.installed ? null : enabled ? (
            <Button
              variant="secondary"
              className="pointer-coarse:min-h-12"
              onClick={() => store.disable(entry.pluginId)}
            >
              {t("plugins.disable")}
            </Button>
          ) : needsApproval ? (
            <Button
              className="pointer-coarse:min-h-12"
              onClick={onReview}
              disabled={!enableable}
              data-command="settings.reviewPlugin"
            >
              {t("plugins.reviewEnable")}
            </Button>
          ) : (
            <Button
              className="pointer-coarse:min-h-12"
              onClick={() => void store.enable(entry.pluginId)}
              disabled={!enableable}
            >
              {t("plugins.enable")}
            </Button>
          )}
          {stopped && (
            <Button
              variant="secondary"
              className="pointer-coarse:min-h-12"
              onClick={() => void store.restart(entry.pluginId)}
            >
              {t("plugins.management.restart")}
            </Button>
          )}
          {entry.installed && (
            <Button
              variant="destructive"
              className="pointer-coarse:min-h-12"
              onClick={() => setRemoving(true)}
            >
              {t("plugins.management.remove")}
            </Button>
          )}
        </div>

        {!entry.installed && (canReinstall || canDeleteData) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {canReinstall && (
              <Button
                variant="secondary"
                className="pointer-coarse:min-h-12"
                onClick={() => setReinstalling(true)}
              >
                {t("plugins.management.reinstall")}
              </Button>
            )}
            {canDeleteData && (
              <Button
                variant="destructive"
                className="pointer-coarse:min-h-12"
                onClick={() => setDeletingData(true)}
              >
                {t("plugins.management.delete")}
              </Button>
            )}
          </div>
        )}

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
            <p className="mt-1 text-sm text-muted-foreground">
              {t("plugins.permissions.grantIntro")}
            </p>
            <PluginPermissionList
              declared={declared}
              required={required}
              checked={(permission) => approval.granted.includes(permission as PluginPermissionId)}
              disabled={(permission) => required.includes(permission) || !reviewApproved}
              onToggle={(permission, next) => {
                if (next) {
                  void store.approve(entry.pluginId, [
                    ...optionalGranted,
                    permission as PluginPermissionId,
                  ]);
                } else {
                  void store.revoke(entry.pluginId, permission as PluginPermissionId);
                }
              }}
              renderAction={(permission) =>
                required.includes(permission) &&
                approval.granted.includes(permission as PluginPermissionId) ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() =>
                      void store.revoke(entry.pluginId, permission as PluginPermissionId)
                    }
                  >
                    {t("plugins.permissions.revokeRequired")}
                  </Button>
                ) : null
              }
              renderDetail={(_permission, info) =>
                info.isRequired && !info.checked ? (
                  <p className="mt-1 pl-6 text-sm text-destructive">
                    {t("plugins.permissions.requiredMissing")}
                  </p>
                ) : (
                  <p className="mt-1 pl-6 text-sm text-muted-foreground">{info.detail}</p>
                )
              }
              rowClassName="border-b border-border py-2 last:border-b-0"
              rowFlexClassName="flex items-center gap-2"
            />
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

        {removing && (
          <PluginRemoveDialog
            isOpen
            name={manifest.name}
            builtIn={entry.builtIn}
            onClose={() => setRemoving(false)}
            onConfirm={(deleteData) => {
              setRemoving(false);
              void store.remove(entry.pluginId, { deleteData });
            }}
          />
        )}
        {deletingData && (
          <PluginConfirmDialog
            isOpen
            title={t("plugins.management.delete")}
            text={t("plugins.management.deleteText")}
            confirmLabel={t("plugins.management.delete")}
            onClose={() => setDeletingData(false)}
            onConfirm={() => {
              setDeletingData(false);
              void store.deleteData(entry.pluginId);
            }}
          />
        )}
        {reinstalling && (
          <PluginConfirmDialog
            isOpen
            title={t("plugins.management.reinstall")}
            text={t("plugins.management.reinstallText")}
            confirmLabel={t("plugins.management.reinstall")}
            onClose={() => setReinstalling(false)}
            onConfirm={() => {
              setReinstalling(false);
              void store.reinstallBuiltIn(entry.pluginId);
            }}
          />
        )}
      </DisclosurePanel>
    </Disclosure>
  );
}
