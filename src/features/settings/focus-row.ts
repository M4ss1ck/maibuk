import { useSettingsRevealStore } from "@/features/settings/settings-reveal-store";
import type { SettingsRowId } from "@/components/settings/settings-sections";

/**
 * Ask the Settings page to reveal and focus a row. The page's effect opens
 * the row's collapsed area (if any), scrolls it into view, and focuses its
 * first control; it works whether Settings is already mounted or mounts
 * later with this id still pending.
 */
export function focusSettingsRow(id: SettingsRowId): void {
  useSettingsRevealStore.getState().requestRow(id);
}
