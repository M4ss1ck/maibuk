/**
 * One Plugin row in Settings (#442, #443): a bordered card whose header holds
 * the name, its origin and state badges, the disclosure chevron, and — outside
 * the disclosure trigger — the enable switch. The expanded panel reads top to
 * bottom: the localized manifest description, the notices (a startup error, a
 * Stopped Plugin reason with Try again or Review, unsupported and duplicate-folder text, the data
 * size warning, the update-available Keep/Replace actions, the custom-UI
 * notice, and the removed third-party note), the Plugin's own Settings surface
 * and rows, a nested Permissions accordion (the granted Plugin Permissions with
 * their revoke controls and the remember-credentials switch, with an issue
 * badge and a Review action when a required grant is missing or the copy is not
 * approved), the expanded-row facts under a Details heading, and the removal
 * and reinstatement actions in a bordered footer.
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
 * the section owns, opened through the callbacks here (#443).
 */

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button as AriaButton, Disclosure, DisclosurePanel } from "react-aria-components";
import { PluginPermissionList } from "@/components/plugins/PluginPermissionList";
import { PluginSettingsRowBody } from "@/components/plugins/PluginSettingsRowBody";
import {
  pluginStartupErrorText,
  pluginStoppedReasonText,
  type StartupErrorTranslate,
} from "@/components/plugins/plugin-startup-error";
import { PluginSurface } from "@/components/plugins/PluginSurface";
import { SettingRow } from "@/components/settings/SettingRow";
import { formatPluginDataSize } from "@/components/settings/plugin-data-size";
import { asPluginTranslate } from "@/components/settings/plugin-translate";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { hasMissingRequired } from "@/features/plugins/approvals";
import { currentUILanguage } from "@/features/plugins/contributions-registry";
import {
  PLUGIN_DATA_SIZE_WARNING_BYTES,
  localizedPluginManifest,
  usePluginManagementStore,
} from "@/features/plugins/management";
import type { PluginManagementEntry, PluginPermissionId } from "@/features/plugins/types";
import {
  getPluginSettingsRows,
  pluginCardRowId,
  rowOnPlatform,
  type SettingsPlatform,
} from "@/features/settings/rows";
import { useStoppedPlugin } from "@/hooks";
import { usePluginSecrets } from "@/hooks/usePluginSecrets";

const BADGE_CLASS =
  "inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground";
// Issue badges (a failure, a needed review, an unsupported or stopped copy) take
// the destructive tone; the informational ones keep the neutral shell.
const ISSUE_BADGE_CLASS =
  "inline-flex items-center rounded-full border border-destructive/40 px-2 py-0.5 text-xs text-destructive";

/**
 * The disclosure panel animation (#442). React Aria Components sets the
 * `--disclosure-panel-height` CSS variable (auto when open, a pixel height
 * while it animates, 0px when collapsed), so the panel animates its height;
 * `aria-hidden` tracks the open state, so opacity fades with it and the
 * collapsed panel stays out of the accessibility tree and the tab order.
 * Reduced-motion turns both transitions off. Shared by the Plugin card, its
 * nested Permissions accordion, and the legacy Settings-owner rows. A closed
 * panel keeps its box (`hidden="until-found"`), so padding goes on a wrapper
 * inside it, never on the panel, or a band shows under every closed header.
 */
export const PLUGIN_DISCLOSURE_PANEL_CLASS =
  "h-(--disclosure-panel-height) overflow-clip opacity-100 transition-[height,opacity] duration-200 ease-out motion-reduce:transition-none aria-hidden:opacity-0";

interface PluginRowProps {
  entry: PluginManagementEntry;
  open: boolean;
  onToggle: () => void;
  /** Opens the permission approval or changed-files review dialog for this Plugin. */
  onReview: () => void;
  /** Opens the replace-confirmation dialog for a modified Built-in copy. */
  onReplace: () => void;
  /** Opens the remove-confirmation dialog for this Plugin. */
  onRemove: () => void;
  /** Opens the reinstall-confirmation dialog for a removed Built-in. */
  onReinstall: () => void;
  /** Opens the Delete-data confirmation dialog for a removed row. */
  onDeleteData: () => void;
  platform: SettingsPlatform;
}

export function PluginRow({
  entry,
  open,
  onToggle,
  onReview,
  onReplace,
  onRemove,
  onReinstall,
  onDeleteData,
  platform,
}: PluginRowProps) {
  const { t, i18n } = useTranslation();
  const translate = asPluginTranslate(t);
  const store = usePluginManagementStore.getState();
  // The data size lives in the store's `dataSizes`, filled by `refreshDataSize`;
  // subscribing here is what re-renders the row when the size arrives.
  const dataSize = usePluginManagementStore((state) => state.dataSizes[entry.pluginId] ?? 0);
  // The saved-credential state comes from the registered store, not the grant:
  // the row shows whether this Plugin really has credentials saved, and — where
  // the store can persist them — the "remember on this device" switch.
  const secrets = usePluginSecrets(entry.pluginId, open);
  const manifest = entry.manifest;
  // The card shows the manifest name and description localized to the UI
  // language (#442); the description is the first line of the expanded panel.
  const localized = localizedPluginManifest(entry, currentUILanguage());
  const name = localized.name;
  const description = localized.description;
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
  const declared = [
    ...required,
    ...optional.filter((permission) => !required.includes(permission)),
  ];
  // The Permissions accordion is its own disclosure, collapsed by default and
  // independent of the card (#442). An installed copy is in issue when a
  // required grant is missing or the copy is not approved; ungranted optional
  // permissions are never an issue.
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const permissionsIssue = entry.installed && (requiredMissing || !reviewApproved);
  // Only a Plugin that declares the secrets permission has credentials to
  // remember, and only a store that can persist them offers the switch.
  const canRememberSecrets = declared.includes("secrets") && secrets.canRemember;
  const optionalGranted =
    approval?.granted.filter((permission) => optional.includes(permission)) ?? [];
  // A copy Settings can never enable: its files are gone, two folders claim its
  // id, or its manifest excludes this device (#443). The control stays visible
  // but disabled so the row explains itself instead of acting.
  const enableable = entry.installed && entry.duplicateFolders.length === 0 && !entry.unsupported;
  const stoppedPlugin = useStoppedPlugin(entry.pluginId);
  const showCustomUi = manifest.customUi === true;
  // A removed Built-in offers Reinstall from the bundled copy; a removed
  // third-party Plugin offers none (the author must add its files again).
  const canReinstall = !entry.installed && entry.builtIn;
  // A removed row keeps its retained data; when it has any, offer to erase it.
  const canDeleteData = !entry.installed && entry.removed && dataSize > 0;
  // The prototype's expanded-row facts: files present or absent, credentials
  // and the approved copy yes or none, and the always-retained Command
  // preferences (#443).
  const facts = [
    {
      label: t("plugins.management.data"),
      value: formatPluginDataSize(dataSize, i18n.language, translate),
    },
    {
      label: t("plugins.management.files"),
      value: t(entry.installed ? "plugins.management.yes" : "plugins.management.no"),
    },
    {
      label: t("plugins.management.credentials"),
      // The real saved-credential state, read from the store, not the grant.
      value: t(secrets.names.length > 0 ? "plugins.management.yes" : "plugins.management.none"),
    },
    {
      label: t("plugins.management.approval"),
      value: t(
        entry.review.status === "approved" ? "plugins.management.yes" : "plugins.management.none"
      ),
    },
    {
      label: t("plugins.management.preferences"),
      value: t("plugins.management.kept"),
    },
  ];
  // The one line that explains an issue in the Permissions accordion: a missing
  // required grant first, then a changed copy, then a never-approved one.
  const issueExplanation = requiredMissing
    ? t("plugins.permissions.issueRequiredMissing")
    : entry.review.status === "review-required"
      ? t("plugins.permissions.issueReview")
      : t("plugins.permissions.issueNotApproved");

  // Expanding a row reads the Plugin's stored data size (#443). The action is
  // read off the store rather than the captured `store` so the effect does not
  // re-run on every unrelated state change (the size write included).
  useEffect(() => {
    if (!open) return;
    void Promise.resolve(usePluginManagementStore.getState().refreshDataSize(entry.pluginId)).catch(
      () => {}
    );
  }, [open, entry.pluginId]);

  return (
    <Disclosure
      isExpanded={open}
      onExpandedChange={onToggle}
      data-settings-row={pluginCardRowId(entry.pluginId)}
      className="rounded-lg border border-border bg-card"
    >
      <div className="flex w-full items-center gap-4 rounded-lg px-3 py-2 hover:bg-muted/40">
        <AriaButton
          slot="trigger"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded py-1 text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="truncate">{name}</span>
          <span className="shrink-0 text-sm font-normal text-muted-foreground">
            {t("plugins.management.version", { version: manifest.version })}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {entry.builtIn && <span className={BADGE_CLASS}>{t("plugins.builtInBadge")}</span>}
            {entry.modified && (
              <span className={BADGE_CLASS}>{t("plugins.management.modified")}</span>
            )}
            {entry.updateAvailable && <span className={BADGE_CLASS}>{t("plugins.available")}</span>}
            {entry.removed && (
              <span className={BADGE_CLASS}>{t("plugins.management.filters.removed")}</span>
            )}
            {entry.unsupported && (
              <span className={ISSUE_BADGE_CLASS}>
                {t("plugins.management.filters.unsupported")}
              </span>
            )}
            {stoppedPlugin !== null && (
              <span className={ISSUE_BADGE_CLASS}>{t("plugins.management.stopped")}</span>
            )}
            {approval?.startupError !== undefined && stoppedPlugin === null && (
              <span className={ISSUE_BADGE_CLASS}>{t("plugins.management.failedToStart")}</span>
            )}
            {entry.review.status === "review-required" && (
              <span className={ISSUE_BADGE_CLASS}>{t("plugins.reviewRequired")}</span>
            )}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${
              open ? "rotate-180" : ""
            }`}
          />
        </AriaButton>
        {entry.installed && (
          <>
            <span aria-hidden="true" className="h-6 w-px shrink-0 bg-border" />
            <Switch
              checked={enabled}
              disabled={!enableable}
              onChange={(next) => {
                if (next) {
                  // A copy that still needs review opens the review dialog; the
                  // switch stays off because it reflects the store's state.
                  if (needsApproval) onReview();
                  else void store.enable(entry.pluginId);
                } else {
                  store.disable(entry.pluginId);
                }
              }}
              label={t("plugins.management.enableSwitch", { name })}
              data-command="settings.togglePlugin"
              className="pointer-coarse:min-h-12 pointer-coarse:min-w-12"
            />
          </>
        )}
      </div>

      <DisclosurePanel className={PLUGIN_DISCLOSURE_PANEL_CLASS}>
        <div className="px-3 pb-3">
          {/* The manifest description, localized, opens the panel. */}
          <p className="text-sm">{description}</p>

          {stoppedPlugin !== null ? (
            <div className="mt-3">
              <p className="text-sm text-destructive">
                {pluginStoppedReasonText(stoppedPlugin.reason, manifest.name, translate)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {stoppedPlugin.action === "tryAgain" ? (
                  <Button
                    variant="secondary"
                    className="pointer-coarse:min-h-12"
                    data-command="settings.restartPlugin"
                    onClick={() => void store.restart(entry.pluginId)}
                  >
                    {t("plugins.stoppedPanel.tryAgain")}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    className="pointer-coarse:min-h-12"
                    data-command="settings.reviewPlugin"
                    onClick={onReview}
                  >
                    {t("plugins.permissions.review")}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            approval?.startupError !== undefined && (
              <p className="mt-3 text-sm text-destructive">
                {pluginStartupErrorText(
                  approval.startupError,
                  t as unknown as StartupErrorTranslate
                )}
              </p>
            )
          )}
          {entry.unsupported && (
            <p className="mt-3 text-sm text-muted-foreground">
              {t("plugins.management.unsupportedText")}
            </p>
          )}
          {entry.duplicateFolders.length > 0 && (
            <p className="mt-3 text-sm text-destructive">
              {t("plugins.management.duplicateText", {
                folders: entry.duplicateFolders.join(", "),
              })}
            </p>
          )}
          {dataSize >= PLUGIN_DATA_SIZE_WARNING_BYTES && (
            <p className="mt-3 text-sm text-destructive">{t("plugins.management.sizeWarning")}</p>
          )}
          {entry.updateAvailable && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                data-command="settings.keepMyCopy"
                onClick={() => void store.keepMyCopy(entry.pluginId)}
              >
                {t("plugins.keep")}
              </Button>
              <Button
                variant="secondary"
                data-command="settings.replaceBuiltIn"
                onClick={onReplace}
              >
                {t("plugins.replace")}
              </Button>
            </div>
          )}
          {showCustomUi && (
            <p className="mt-3 text-sm text-muted-foreground">{t("plugins.management.custom")}</p>
          )}
          {!entry.installed && !entry.builtIn && (
            <p className="mt-3 text-sm text-muted-foreground">{t("plugins.management.manual")}</p>
          )}

          <PluginSurface pluginId={entry.pluginId} surface="settings" />
          {rows.map((row) => (
            // A Plugin Settings row holds the Plugin's own tall body (several
            // controls, a heading, a list). It cannot sit in the label-left,
            // control-right row shell the simple rows use: stacked like the
            // Dictation model list and the Backups list, the label and description
            // read at the top and the Plugin's controls take the full width below.
            <SettingRow key={row.id} id={row.id} className="flex flex-col gap-2 py-3">
              <PluginSettingsRowBody pluginId={entry.pluginId} rowId={row.localId} />
            </SettingRow>
          ))}

          {declared.length > 0 && (
            <Disclosure
              isExpanded={permissionsOpen}
              onExpandedChange={setPermissionsOpen}
              className="mt-3 rounded-lg border border-border"
            >
              <AriaButton
                slot="trigger"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span>{t("plugins.permissions.grantTitle")}</span>
                {permissionsIssue && (
                  <span className={ISSUE_BADGE_CLASS}>
                    {t("plugins.permissions.needsAttention")}
                  </span>
                )}
                <ChevronDown
                  aria-hidden="true"
                  className={`ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${
                    permissionsOpen ? "rotate-180" : ""
                  }`}
                />
              </AriaButton>
              <DisclosurePanel className={PLUGIN_DISCLOSURE_PANEL_CLASS}>
                <div className="px-3 pb-3">
                  {permissionsIssue && (
                    <p className="text-sm text-destructive">{issueExplanation}</p>
                  )}
                  {approval !== null && (
                    <>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("plugins.permissions.grantIntro")}
                      </p>
                      <PluginPermissionList
                        declared={declared}
                        required={required}
                        checked={(permission) =>
                          approval.granted.includes(permission as PluginPermissionId)
                        }
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
                    </>
                  )}
                  {canRememberSecrets && (
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{t("plugins.management.remember")}</p>
                        <p className="text-sm text-muted-foreground">
                          {t("plugins.management.rememberDescription")}
                        </p>
                      </div>
                      <Switch
                        checked={secrets.remembered}
                        onChange={(next) => secrets.setRemembered(next)}
                        label={t("plugins.management.remember")}
                        className="pointer-coarse:min-h-12"
                      />
                    </div>
                  )}
                  {permissionsIssue && (
                    <div className="mt-3">
                      <Button
                        className="pointer-coarse:min-h-12"
                        data-command="settings.reviewPlugin"
                        disabled={!enableable}
                        onClick={onReview}
                      >
                        {t("plugins.permissions.review")}
                      </Button>
                    </div>
                  )}
                </div>
              </DisclosurePanel>
            </Disclosure>
          )}

          <div className="mt-3">
            <h3 className="text-sm font-medium">{t("plugins.management.details")}</h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground sm:grid-cols-3">
              {facts.map((fact) => (
                <div key={fact.label} className="flex flex-col">
                  <dt>{fact.label}</dt>
                  <dd className="font-medium text-foreground">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {(entry.installed || canReinstall || canDeleteData) && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
              {entry.installed && (
                <Button
                  variant="destructive"
                  className="pointer-coarse:min-h-12"
                  data-command="settings.removePlugin"
                  onClick={onRemove}
                >
                  {t("plugins.management.remove")}
                </Button>
              )}
              {canReinstall && (
                <Button
                  variant="secondary"
                  className="pointer-coarse:min-h-12"
                  data-command="settings.reinstallBuiltIn"
                  onClick={onReinstall}
                >
                  {t("plugins.management.reinstall")}
                </Button>
              )}
              {canDeleteData && (
                <Button
                  variant="destructive"
                  className="pointer-coarse:min-h-12"
                  data-command="settings.deletePluginData"
                  onClick={onDeleteData}
                >
                  {t("plugins.management.delete")}
                </Button>
              )}
            </div>
          )}
        </div>
      </DisclosurePanel>
    </Disclosure>
  );
}
