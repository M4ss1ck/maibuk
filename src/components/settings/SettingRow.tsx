import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  findSettingsRow,
  type SettingsRowId,
} from "@/components/settings/settings-sections";

interface SettingRowProps {
  id: SettingsRowId;
  /** The row's controls; the label and description come from the declaration. */
  children: ReactNode;
  /** The row's layout classes (the exact ones the row used before). */
  className?: string;
  /** Classes for the label block (e.g. "flex-1" where the row needs it). */
  labelWrapperClassName?: string;
  /** Only when the label needs its own color (e.g. destructive). */
  labelClassName?: string;
  /**
   * Only for rows whose label never existed on screen: the label stays in
   * the DOM for the palette and the row anchor, but visually hidden, while
   * the description (when the row has one) renders exactly as before.
   */
  labelHidden?: boolean;
  /**
   * Only when the label area holds more than the declared label and
   * description (a count line, a dynamic status). Rendered below them.
   */
  labelExtra?: ReactNode;
  /**
   * Only when the description is dynamic and no descriptionKey covers it.
   * Rendered in place of the declared description.
   */
  descriptionOverride?: ReactNode;
  /**
   * Row-level blur handler (e.g. committing a draft when focus leaves the
   * row). Focus moving between the row's own controls does not trigger it.
   */
  onBlur?: (event: React.FocusEvent<HTMLDivElement>) => void;
  /**
   * Only when the row's component already renders the same heading visibly
   * (a wrapped list with its own title). The declared label and description
   * stay in the DOM for the palette and the row anchor, but visually hidden.
   */
  visuallyHiddenLabel?: boolean;
}

/**
 * One Settings row: the anchor the Command Palette focuses, named by the
 * section's declaration. The visible label and description render here from
 * the declaration so the palette and the screen can never disagree.
 */
export function SettingRow({
  id,
  children,
  className,
  labelWrapperClassName,
  labelClassName,
  labelExtra,
  descriptionOverride,
  visuallyHiddenLabel = false,
  labelHidden = false,
  onBlur,
}: SettingRowProps) {
  const { t } = useTranslation();
  // Row declarations carry plain-string keys; resolve them like the Tutorial
  // section does for its composed keys.
  const translate = t as unknown as (key: string) => string;
  const found = findSettingsRow(id);
  const row = found?.row;
  if (labelHidden) {
    // No label wrapper: the sr-only label is absolutely positioned (out of
    // flow), so the description and the controls keep the exact flex layout
    // the row had before the migration.
    return (
      <div data-settings-row={id} className={className} onBlur={onBlur}>
        <p className="sr-only">{row ? translate(row.labelKey) : id}</p>
        {descriptionOverride ??
          (row?.descriptionKey ? (
            <p className="text-sm text-muted-foreground">
              {translate(row.descriptionKey)}
            </p>
          ) : null)}
        {labelExtra}
        {children}
      </div>
    );
  }
  const hidden = visuallyHiddenLabel ? "sr-only" : undefined;

  return (
    <div data-settings-row={id} className={className} onBlur={onBlur}>
      <div className={labelWrapperClassName}>
        <p className={hidden ?? labelClassName ?? "font-medium"}>
          {row ? translate(row.labelKey) : id}
        </p>
        {descriptionOverride ??
          (row?.descriptionKey ? (
            <p className={hidden ?? "text-sm text-muted-foreground"}>
              {translate(row.descriptionKey)}
            </p>
          ) : null)}
        {labelExtra}
      </div>
      {children}
    </div>
  );
}
