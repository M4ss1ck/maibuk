import type { HTMLAttributes, ReactNode } from "react";
import type { SETTINGS_SECTIONS } from "@/components/settings/settings-sections";

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/**
 * The rows of a section: one divider between top-level rows, each row `py-3`,
 * and the first and last rows flush with the card padding. Exported for a
 * section whose rows live inside a nested panel (Dictation's language tabs).
 */
export const SETTINGS_ROWS_CLASS =
  "divide-y divide-border [&>*:first-child]:pt-0 [&>*:last-child]:pb-0";

/** A row with its label on the left and its control on the right once there is room. */
export const SETTINGS_ROW_CLASS =
  "flex flex-col @lg:flex-row @lg:items-center justify-between py-3 gap-2 @lg:gap-4";

interface SettingsSectionProps extends Omit<HTMLAttributes<HTMLElement>, "title" | "className"> {
  /** The section id the outline, the palette, and focus fallbacks find it by. */
  sectionId: SettingsSectionId;
  title: ReactNode;
  /** Sits under the title, before the rows. */
  description?: ReactNode;
  tone?: "primary" | "destructive";
  /** The title stays in the DOM for the outline and screen readers only. */
  titleHidden?: boolean;
  /** Extra attributes for the `<h2>`, such as a Tutorial anchor. */
  titleAttributes?: Record<`data-${string}`, string>;
  /** Wraps the title, e.g. in a disclosure trigger. Receives the `<h2>`. */
  renderTitle?: (heading: ReactNode) => ReactNode;
  children?: ReactNode;
}

/**
 * One Settings section: the same card, title, and row rhythm for every
 * section, so no section invents its own separators.
 */
export function SettingsSection({
  sectionId,
  title,
  description,
  tone = "primary",
  titleHidden = false,
  titleAttributes,
  renderTitle,
  children,
  ...rest
}: SettingsSectionProps) {
  const heading = (
    <h2
      {...titleAttributes}
      tabIndex={-1}
      data-settings-section={sectionId}
      className={
        titleHidden
          ? "sr-only"
          : `text-lg font-medium ${tone === "destructive" ? "text-destructive" : "text-primary"}`
      }
    >
      {title}
    </h2>
  );

  const hasRows = children !== undefined && children !== null && children !== false;
  const showHeader = !titleHidden || description;

  return (
    <section {...rest} className="mb-6 @lg:mb-8 rounded-xl border border-border p-4 @lg:p-5">
      {showHeader ? (
        <div className={hasRows ? "mb-3" : undefined}>
          {renderTitle ? renderTitle(heading) : heading}
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
      ) : (
        heading
      )}
      {hasRows && <div className={SETTINGS_ROWS_CLASS}>{children}</div>}
    </section>
  );
}
