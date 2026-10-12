/**
 * The Plugin Permissions list shared by the approval dialog, the changed-files
 * review dialog, and PluginRow (#442). Each row shows a permission's plain
 * language title, its required/optional label, a checkbox (locked for a
 * required one), and its detail line. A caller may append a diff label, a
 * revoke control, or a different detail line.
 */

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  pluginPermissionCopy,
  type PermissionTranslate,
} from "@/components/plugins/plugin-permission-copy";
import { Checkbox } from "@/components/ui/Checkbox";

/** What a caller's detail renderer reads about one row. */
export interface PluginPermissionRowInfo {
  isRequired: boolean;
  checked: boolean;
  /** The permission's plain-language detail, from `pluginPermissionCopy`. */
  detail: string;
}

export interface PluginPermissionListProps {
  /** Every declared permission, required first, in display order. */
  declared: readonly string[];
  /** The subset that is required to enable the Plugin. */
  required: readonly string[];
  /** Whether one permission is granted or chosen right now. */
  checked(permission: string): boolean;
  /** Toggles an optional permission; required ones stay locked. */
  onToggle(permission: string, next: boolean): void;
  /** Whether a row's checkbox is locked; defaults to a required permission. */
  disabled?(permission: string): boolean;
  /** Extra text appended to a row's title (the review dialog's diff labels). */
  labelSuffix?(permission: string): string | null;
  /** Extra control after a row's title (the row's revoke-required button). */
  renderAction?(permission: string): ReactNode;
  /** Replaces a row's detail line; defaults to the permission's detail copy. */
  renderDetail?(permission: string, info: PluginPermissionRowInfo): ReactNode;
  className?: string;
  rowClassName?: string;
  rowFlexClassName?: string;
}

export function PluginPermissionList({
  declared,
  required,
  checked,
  onToggle,
  disabled,
  labelSuffix,
  renderAction,
  renderDetail,
  className,
  rowClassName = "border-b border-border py-3 last:border-b-0",
  rowFlexClassName = "flex items-start gap-2",
}: PluginPermissionListProps) {
  const { t } = useTranslation();
  const translate = t as unknown as PermissionTranslate;

  return (
    <div className={className}>
      {declared.map((permission) => {
        const isRequired = required.includes(permission);
        const isChecked = checked(permission);
        const isDisabled = disabled ? disabled(permission) : isRequired;
        const copy = pluginPermissionCopy(permission, translate);
        const suffix = labelSuffix?.(permission) ?? null;
        const label = `${copy.title} · ${t(
          isRequired ? "plugins.permissions.requiredLabel" : "plugins.permissions.optionalLabel"
        )}${suffix !== null ? ` · ${suffix}` : ""}`;
        return (
          <div key={permission} className={rowClassName}>
            <div className={rowFlexClassName}>
              <Checkbox
                checked={isChecked}
                disabled={isDisabled}
                label={label}
                onChange={(next) => {
                  if (isDisabled) return;
                  onToggle(permission, next);
                }}
              />
              <span className="font-medium">{label}</span>
              {renderAction?.(permission)}
            </div>
            {renderDetail ? (
              renderDetail(permission, { isRequired, checked: isChecked, detail: copy.detail })
            ) : (
              <p className="mt-1 pl-6 text-sm text-muted-foreground">{copy.detail}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
