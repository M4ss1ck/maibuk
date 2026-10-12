/**
 * The Plugin permission approval dialog (#442). It shows every Plugin
 * Permission the manifest declares in plain language: required ones are
 * checked and locked, optional ones are toggled on by default, and the
 * author-responsibility notice (and the custom-UI notice, when the manifest
 * declares one) frames the decision. Approving pins the current copy and
 * enables it.
 *
 * Built on the shared React Aria `Modal`, so focus enters, Tab stays inside,
 * Escape closes, and focus returns to the action that opened it.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { pluginPermissionCopy, type PermissionTranslate } from "@/components/plugins/plugin-permission-copy";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Modal } from "@/components/ui/Modal";
import type { PluginManifest, PluginPermissionId } from "@/features/plugins/types";

interface PluginPermissionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The copy under review; null while no Plugin is being reviewed. */
  manifest: PluginManifest | null;
  /** Approves the copy with the chosen optional grants. */
  onApprove: (optionalGranted: PluginPermissionId[]) => void;
}

export function PluginPermissionDialog({
  isOpen,
  onClose,
  manifest,
  onApprove,
}: PluginPermissionDialogProps) {
  const { t } = useTranslation();
  const translate = t as unknown as PermissionTranslate;
  // Null until the author changes a toggle, so an open dialog starts with every
  // optional Plugin Permission granted; resetting on close keeps a reopen fresh.
  const [selection, setSelection] = useState<string[] | null>(null);
  const required = manifest?.permissions.required ?? [];
  const optional = manifest?.permissions.optional ?? [];

  useEffect(() => {
    if (!isOpen) setSelection(null);
  }, [isOpen]);

  if (!isOpen || manifest === null) return null;

  const chosen = selection ?? optional;
  const declared = [...required, ...optional.filter((permission) => !required.includes(permission))];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("plugins.permissions.reviewTitle")}
      size="lg"
      footer={
        <Button onClick={() => onApprove(chosen as PluginPermissionId[])}>
          {t("plugins.permissions.approve")}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">{t("plugins.permissions.responsibility")}</p>
      <div className="mt-3">
        {declared.map((permission) => {
          const isRequired = required.includes(permission);
          const checked = isRequired || chosen.includes(permission);
          const copy = pluginPermissionCopy(permission, translate);
          const label = `${copy.title} · ${t(
            isRequired ? "plugins.permissions.requiredLabel" : "plugins.permissions.optionalLabel"
          )}`;
          return (
            <div key={permission} className="border-b border-border py-3 last:border-b-0">
              <div className="flex items-start gap-2">
                <Checkbox
                  checked={checked}
                  disabled={isRequired}
                  label={label}
                  onChange={(next) => {
                    if (isRequired) return;
                    setSelection((current) => {
                      const base = current ?? optional;
                      return next
                        ? [...base, permission]
                        : base.filter((entry) => entry !== permission);
                    });
                  }}
                />
                <span className="font-medium">{label}</span>
              </div>
              <p className="mt-1 pl-6 text-sm text-muted-foreground">{copy.detail}</p>
            </div>
          );
        })}
      </div>
      {manifest.customUi === true && (
        <p className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          {t("plugins.permissions.frame")}
        </p>
      )}
    </Modal>
  );
}
