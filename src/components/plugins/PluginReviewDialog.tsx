/**
 * The changed-files review dialog (#442). A copy whose files changed stays off
 * until the author reviews it: this dialog shows the per-file diff the review
 * found (Added, Changed, Removed), the permission diff since the last approval
 * (Added, Removed, Now required), an "Older version" label when the installed
 * copy is behind the approved one, and `noChanges` when only the files moved.
 *
 * The required Plugin Permissions the new copy needs are checked and locked,
 * exactly as in the permission approval dialog; the optional ones are toggled
 * on by default. Approving re-pins the reviewed copy through the store's
 * `markReviewed` and starts it.
 *
 * Built on the shared React Aria `Modal`, so focus enters, Tab stays inside,
 * Escape closes, and focus returns to the action that opened it.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PluginPermissionList } from "@/components/plugins/PluginPermissionList";
import {
  pluginPermissionCopy,
  type PermissionTranslate,
} from "@/components/plugins/plugin-permission-copy";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type {
  PluginManagementEntry,
  PluginPermissionChange,
  PluginPermissionId,
} from "@/features/plugins/types";

interface PluginReviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The copy under review; null while no Plugin is being reviewed. */
  entry: PluginManagementEntry | null;
  /** Approves the reviewed copy with the chosen optional grants. */
  onApprove: (optionalGranted: PluginPermissionId[]) => void;
}

/** The i18n suffix of one permission diff row's label, or null when unchanged. */
function changeLabelKey(
  permission: string,
  diff: { added: PluginPermissionChange[]; nowRequired: PluginPermissionChange[] }
): string | null {
  if (diff.nowRequired.some((change) => change.permission === permission)) {
    return "plugins.nowRequired";
  }
  if (diff.added.some((change) => change.permission === permission)) return "plugins.added";
  return null;
}

export function PluginReviewDialog({
  isOpen,
  onClose,
  entry,
  onApprove,
}: PluginReviewDialogProps) {
  const { t } = useTranslation();
  const translate = t as unknown as PermissionTranslate;
  // Null until the author changes a toggle, so an open dialog starts with every
  // optional Plugin Permission granted; resetting on close keeps a reopen fresh.
  const [selection, setSelection] = useState<string[] | null>(null);

  useEffect(() => {
    if (!isOpen) setSelection(null);
  }, [isOpen]);

  if (!isOpen || entry === null) return null;

  const { manifest, review } = entry;
  const required = manifest.permissions.required;
  const optional = manifest.permissions.optional;
  const declared = [...required, ...optional.filter((permission) => !required.includes(permission))];
  const chosen = selection ?? optional;
  const files = review.files;
  const fileSections: Array<{ key: string; label: string; paths: string[] }> = [
    { key: "added", label: t("plugins.added"), paths: files.added },
    { key: "changed", label: t("plugins.changed"), paths: files.changed },
    { key: "removed", label: t("plugins.removed"), paths: files.removed },
  ].filter((section) => section.paths.length > 0);
  const permissionChanges = [
    ...review.permissions.added,
    ...review.permissions.removed,
    ...review.permissions.nowRequired,
    ...review.permissions.nowOptional,
  ];
  const noChanges = permissionChanges.length === 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("plugins.reviewRequired")}
      size="lg"
      footer={
        <Button onClick={() => onApprove(chosen as PluginPermissionId[])}>
          {t("plugins.permissions.approve")}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">{t("plugins.permissions.responsibility")}</p>

      {review.olderVersion && (
        <p className="mt-2 text-sm font-medium text-destructive">{t("plugins.olderVersion")}</p>
      )}

      {fileSections.length > 0 && (
        <div className="mt-3">
          {fileSections.map((section) => (
            <div key={section.key} className="mt-2">
              <p className="text-xs font-medium text-muted-foreground">{section.label}</p>
              <ul className="font-mono text-xs">
                {section.paths.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3">
        <h3 className="text-sm font-medium">{t("plugins.permissions.grantTitle")}</h3>
        {noChanges && (
          <p className="mt-1 text-sm text-muted-foreground">{t("plugins.noChanges")}</p>
        )}
        <PluginPermissionList
          declared={declared}
          required={required}
          checked={(permission) => required.includes(permission) || chosen.includes(permission)}
          onToggle={(permission, next) =>
            setSelection((current) => {
              const base = current ?? optional;
              return next
                ? [...base, permission]
                : base.filter((entry) => entry !== permission);
            })
          }
          labelSuffix={(permission) => {
            const labelKey = changeLabelKey(permission, review.permissions);
            return labelKey === null ? null : translate(labelKey);
          }}
        />
        {review.permissions.removed.length > 0 && (
          <ul className="mt-2 space-y-1">
            {review.permissions.removed.map((change) => {
              const copy = pluginPermissionCopy(change.permission, translate);
              return (
                <li key={change.permission} className="text-sm">
                  {copy.title} · {t("plugins.removed")}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {manifest.customUi === true && (
        <p className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          {t("plugins.permissions.frame")}
        </p>
      )}
    </Modal>
  );
}
