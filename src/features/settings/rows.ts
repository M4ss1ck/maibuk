import { IS_ANDROID, IS_DESKTOP, IS_WEB } from "@/lib/platform";

export type SettingsPlatform = "web" | "desktop" | "android";

export type SettingsReveal =
  | { kind: "advanced" }
  | { kind: "pasteCleanupAdvanced" }
  | { kind: "dictationLanguage" };

export interface SettingsRowDef {
  /** camelCase, unique across all sections. */
  id: string;
  /** i18n key of the row's visible label. */
  labelKey: string;
  /** i18n key of its description, when it has one. */
  descriptionKey?: string;
  /** i18n key whose value is a string ARRAY of extra search terms. */
  keywordsKey?: string;
  /** Omitted = every platform. */
  platforms?: readonly SettingsPlatform[];
  /** What must open before the row's control exists. */
  reveal?: SettingsReveal;
}

export interface SettingsSectionDef {
  id: string;
  labelKey: string;
  rows: readonly SettingsRowDef[];
}

export function currentSettingsPlatform(): SettingsPlatform {
  if (IS_ANDROID) return "android";
  if (IS_DESKTOP) return "desktop";
  if (IS_WEB) return "web";
  // iOS and unknown Tauri targets behave like the web screen: no desktop-only
  // rows and no Android-only rows.
  return "web";
}

export function rowOnPlatform(row: SettingsRowDef, platform: SettingsPlatform): boolean {
  return row.platforms === undefined || row.platforms.includes(platform);
}
