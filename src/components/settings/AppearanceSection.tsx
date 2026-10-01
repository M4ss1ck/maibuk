import { useTranslation } from "react-i18next";
import { useTheme } from "@/features/theme";
import {
  useSettings,
  DEFAULT_PRIMARY_COLOR,
  FONT_SIZE_OPTIONS,
  FONT_OPTIONS,
  type FontSize,
  type FontFamily,
} from "@/features/settings";
import { Select, Button } from "@/components/ui";
import { ColorPickerControl } from "@/components/ui/ColorPickerControl";
import { applyAccentColor } from "@/features/settings/accent-color";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsSection, SETTINGS_ROW_CLASS } from "@/components/settings/SettingsSection";

export function AppearanceSection() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { appFontSize, appFont, primaryColor, setAppFontSize, setAppFont, setPrimaryColor } =
    useSettings();

  return (
    <SettingsSection
      sectionId="appearance"
      title={t("settings.appearance")}
      data-tutorial="settings.appearance"
    >
      <SettingRow id="theme" className={SETTINGS_ROW_CLASS}>
        {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of toggle buttons, not a form fieldset. */}
        <div
          role="group"
          aria-label={t("settings.theme")}
          className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit"
        >
          {(["light", "dark", "system"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              aria-pressed={theme === value}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                theme === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`settings.${value}`)}
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow id="appFontSize" className={SETTINGS_ROW_CLASS}>
        <Select<FontSize>
          ariaLabel={t("settings.fontSize")}
          value={appFontSize}
          onChange={setAppFontSize}
          options={FONT_SIZE_OPTIONS}
        />
      </SettingRow>

      <SettingRow id="appFont" className={SETTINGS_ROW_CLASS}>
        <Select<FontFamily>
          ariaLabel={t("settings.font")}
          value={appFont}
          onChange={setAppFont}
          options={FONT_OPTIONS}
        />
      </SettingRow>

      <SettingRow id="primaryColor" className={SETTINGS_ROW_CLASS}>
        <div className="flex items-center gap-2">
          <ColorPickerControl
            label={t("settings.primaryColor")}
            value={primaryColor}
            onPreview={(color) => applyAccentColor(color ?? primaryColor)}
            onCommit={setPrimaryColor}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPrimaryColor(DEFAULT_PRIMARY_COLOR)}
            disabled={primaryColor === DEFAULT_PRIMARY_COLOR}
          >
            {t("settings.resetPrimaryColor")}
          </Button>
        </div>
      </SettingRow>
    </SettingsSection>
  );
}
