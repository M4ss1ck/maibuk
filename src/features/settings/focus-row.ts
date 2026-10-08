import {
  useSettingsRevealStore,
  type SettingsRowAlign,
} from "@/features/settings/settings-reveal-store";
import type { SettingsRowId } from "@/components/settings/settings-sections";

/**
 * Ask the Settings page to reveal and focus a row. The page's effect opens
 * the row's collapsed area (if any), scrolls it into view, and focuses its
 * first control; it works whether Settings is already mounted or mounts
 * later with this id still pending. `align: "section"` puts the row's section
 * heading at the top instead of centering the row: the way to link a section.
 */
export function focusSettingsRow(
  id: SettingsRowId,
  { align = "row" }: { align?: SettingsRowAlign } = {}
): void {
  useSettingsRevealStore.getState().requestRow(id, align);
}
